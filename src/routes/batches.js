const express = require("express");
const { query } = require("../config/db");
const { publishControlState } = require("../config/mqtt");
const asyncHandler = require("../utils/asyncHandler");
const HttpError = require("../utils/httpError");
const { ok, parseBool, ensureEnum } = require("../utils/routeHelpers");
const { requireAdmin } = require("../middleware/auth");
const { writeLog } = require("../services/logService");
const { ingestSensorValue } = require("../services/sensorService");
const { getBatchPhaseInfo, executePhaseActions } = require("../services/batchService");
const { getAccessibleDryerIds, ensureDryerAccess, inClauseFromIds } = require("../services/scopeService");

const router = express.Router();

router.post("/batches", asyncHandler(async (req, res) => {
  const { dry_id, fruit_id, recipe_id, operation_mode, threshold_enabled = false, is_customize = false, scheduled_delay_seconds = null, scheduled_start_time = null } = req.body;
  if (!dry_id || !fruit_id || !recipe_id || !operation_mode) {
    throw new HttpError(400, "VALIDATION_ERROR", "dry_id, fruit_id, recipe_id, operation_mode are required");
  }
  ensureEnum(operation_mode, ["manual", "scheduled"], "operation_mode");

  let finalDelaySeconds = null;
  let scheduledStartTime = null;

  if (operation_mode === 'scheduled') {
    const hasDelay = scheduled_delay_seconds !== null && scheduled_delay_seconds !== undefined;
    const hasTime = scheduled_start_time !== null && scheduled_start_time !== undefined;

    if (!hasDelay && !hasTime) {
      throw new HttpError(400, "VALIDATION_ERROR", "scheduled_delay_seconds or scheduled_start_time is required for scheduled mode");
    }
    if (hasDelay && hasTime) {
      throw new HttpError(400, "VALIDATION_ERROR", "Cannot specify both scheduled_delay_seconds and scheduled_start_time");
    }

    if (hasDelay) {
      if (typeof scheduled_delay_seconds !== 'number' || scheduled_delay_seconds <= 0) {
        throw new HttpError(400, "VALIDATION_ERROR", "scheduled_delay_seconds must be a positive number");
      }
      finalDelaySeconds = scheduled_delay_seconds;
      scheduledStartTime = new Date(Date.now() + scheduled_delay_seconds * 1000);
    }

    if (hasTime) {
      scheduledStartTime = new Date(scheduled_start_time);
      if (Number.isNaN(scheduledStartTime.getTime())) {
        throw new HttpError(400, "VALIDATION_ERROR", "scheduled_start_time must be a valid date/time string");
      }
      if (scheduledStartTime <= new Date()) {
        throw new HttpError(400, "VALIDATION_ERROR", "scheduled_start_time must be a future time");
      }
      finalDelaySeconds = null;
    }
  } else {
    if (scheduled_delay_seconds !== null || scheduled_start_time !== null) {
      throw new HttpError(400, "VALIDATION_ERROR", "scheduled_delay_seconds and scheduled_start_time are only valid in scheduled mode");
    }
  }

  const allowed = await ensureDryerAccess(req.user, Number(dry_id));
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to dryer");

  const dryerStatus = await query(`SELECT status FROM Dryer WHERE dry_id = $1`, [Number(dry_id)]);
  const dryer = dryerStatus.rows[0];
  if (!dryer) throw new HttpError(404, "NOT_FOUND", "Dryer not found");
  if (dryer.status !== "Idle") throw new HttpError(409, "CONFLICT", "Dryer must be Idle before creating batch");

  const running = await query(
    `SELECT COUNT(*)::int AS total FROM batch WHERE dry_id = $1 AND status = 'running'`,
    [Number(dry_id)]
  );
  if (running.rows[0].total > 0) throw new HttpError(409, "CONFLICT", "Dryer already has a running batch");

  const recipeCheck = await query(
    `SELECT recipe_id FROM recipe WHERE recipe_id = $1`,
    [Number(recipe_id)]
  );
  if (!recipeCheck.rows.length) throw new HttpError(404, "NOT_FOUND", "Recipe not found");

  const fruitCheck = await query(
    `SELECT fruit_id FROM fruit WHERE fruit_id = $1`,
    [Number(fruit_id)]
  );
  if (!fruitCheck.rows.length) throw new HttpError(404, "NOT_FOUND", "Fruit type not found");

  const raceCheckResult = await query(
    `SELECT COUNT(*)::int AS total FROM batch WHERE dry_id = $1 AND status = 'running'`,
    [Number(dry_id)]
  );
  if (raceCheckResult.rows[0].total > 0) throw new HttpError(409, "CONFLICT", "Dryer now has a running batch (concurrent request)");

  const result = await query(
    `INSERT INTO batch (status, operation_mode, threshold_enabled, is_customize, scheduled_delay_seconds, scheduled_start_time, dry_id, fruit_id, recipe_id, app_user_id)
     VALUES ('pending', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING batch_id, status, operation_mode, threshold_enabled, is_customize, scheduled_delay_seconds, scheduled_start_time, dry_id, fruit_id, recipe_id, app_user_id, created_at`,
    [operation_mode, Boolean(threshold_enabled), Boolean(is_customize), finalDelaySeconds, scheduledStartTime, Number(dry_id), Number(fruit_id), Number(recipe_id), req.user.id]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.patch("/batches/:id/schedule", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const { scheduled_delay_seconds = null, scheduled_start_time = null } = req.body;
  const hasDelay = scheduled_delay_seconds !== null && scheduled_delay_seconds !== undefined;
  const hasTime = scheduled_start_time !== null && scheduled_start_time !== undefined;

  if (!hasDelay && !hasTime) {
    throw new HttpError(400, "VALIDATION_ERROR", "scheduled_delay_seconds or scheduled_start_time is required");
  }
  if (hasDelay && hasTime) {
    throw new HttpError(400, "VALIDATION_ERROR", "Cannot specify both scheduled_delay_seconds and scheduled_start_time");
  }

  const batchResult = await query(
    `SELECT batch_id, status, operation_mode, dry_id
     FROM batch WHERE batch_id = $1`,
    [batchId]
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  if (batch.operation_mode !== "scheduled") {
    throw new HttpError(422, "BUSINESS_RULE_VIOLATION", "Only scheduled batches can be rescheduled");
  }
  if (batch.status !== "pending") {
    throw new HttpError(409, "CONFLICT", "Only pending scheduled batches can be updated");
  }

  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");

  let finalDelaySeconds = null;
  let scheduledStartTime = null;

  if (hasDelay) {
    if (typeof scheduled_delay_seconds !== 'number' || scheduled_delay_seconds <= 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "scheduled_delay_seconds must be a positive number");
    }
    finalDelaySeconds = scheduled_delay_seconds;
    scheduledStartTime = new Date(Date.now() + scheduled_delay_seconds * 1000);
  }

  if (hasTime) {
    scheduledStartTime = new Date(scheduled_start_time);
    if (Number.isNaN(scheduledStartTime.getTime())) {
      throw new HttpError(400, "VALIDATION_ERROR", "scheduled_start_time must be a valid date/time string");
    }
    if (scheduledStartTime <= new Date()) {
      throw new HttpError(400, "VALIDATION_ERROR", "scheduled_start_time must be a future time");
    }
    finalDelaySeconds = null;
  }

  await query(
    `UPDATE batch SET scheduled_delay_seconds = $1, scheduled_start_time = $2 WHERE batch_id = $3`,
    [finalDelaySeconds, scheduledStartTime, batchId]
  );

  return ok(res, { batch_id: batchId, scheduled_delay_seconds: finalDelaySeconds, scheduled_start_time: scheduledStartTime });
}));

router.get("/batches", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `b.dry_id IN ${inClauseFromIds(dryerIds)}`;
  const result = await query(
    `SELECT b.batch_id, b.start_time, b.end_time, b.status, b.operation_mode, b.threshold_enabled,
            b.is_customize,b.scheduled_delay_seconds, b.scheduled_start_time, b.dry_id, b.fruit_id, b.recipe_id, b.app_user_id, b.created_at
     FROM batch b
     WHERE ${scopeClause}
       AND ($1::text IS NULL OR b.status = $1)
       AND ($2::text IS NULL OR b.operation_mode = $2)
       AND ($3::int IS NULL OR b.dry_id = $3)
       AND ($4::timestamptz IS NULL OR b.created_at >= $4)
       AND ($5::timestamptz IS NULL OR b.created_at <= $5)
     ORDER BY b.batch_id DESC`,
    [req.query.status || null, req.query.operation_mode || null,
     req.query.dry_id ? Number(req.query.dry_id) : null,
     req.query.from ? new Date(req.query.from) : null,
     req.query.to ? new Date(req.query.to) : null]
  );
  return ok(res, result.rows);
}));

router.get("/batches/:id", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const batchResult = await query(
    `SELECT batch_id, start_time, end_time, status, operation_mode, threshold_enabled,
            is_customize, scheduled_delay_seconds, scheduled_start_time, dry_id, fruit_id, recipe_id, app_user_id, created_at
     FROM batch WHERE batch_id = $1`,
    [batchId]
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  const phases = await query(
    `SELECT phase_id, phase_order, duration_seconds, humidity, temperature, light
     FROM phase WHERE recipe_id = $1 ORDER BY phase_order`,
    [batch.recipe_id]
  );
  const controls = await query(
    `SELECT control_id, control_name, control_type, status FROM control_device
     WHERE dry_id = $1 ORDER BY control_id`,
    [batch.dry_id]
  );
  const phaseInfo = await getBatchPhaseInfo(batchId);
  // Sensor data is ALWAYS returned, regardless of threshold_enabled flag
  // threshold_enabled only controls whether threshold conditions trigger auto-actions
  const sensorData = (await query(
    `SELECT sd.sensor_id, sd.sensor_type, sd.threshold, sl.last_value, sl.updated_at
     FROM sensor_device sd
     LEFT JOIN sensor_latest sl ON sl.sensor_id = sd.sensor_id
     WHERE sd.dry_id = $1
     ORDER BY sd.sensor_id`,
    [batch.dry_id]
  )).rows;
  const response = {
    ...batch,
    phases: phases.rows,
    controls: controls.rows,
    scheduled_phase_info: phaseInfo,
    sensor_data: sensorData,
  };
  return ok(res, response);
}));

router.post("/batches/:id/start", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const batchResult = await query(
    `SELECT batch_id, status, dry_id, recipe_id FROM batch WHERE batch_id = $1`,
    [batchId]
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  if (batch.status !== "pending") throw new HttpError(409, "CONFLICT", "Only pending batch can be started");

  const phasesResult = await query(
    `SELECT phase_id FROM phase WHERE recipe_id = $1 LIMIT 1`,
    [batch.recipe_id]
  );
  if (!phasesResult.rows.length) {
    throw new HttpError(409, "CONFLICT", "Batch recipe has no phases configured");
  }

  const runningBatchResult = await query(
    `SELECT COUNT(*)::int AS total FROM batch WHERE dry_id = $1 AND status = 'running' AND batch_id != $2`,
    [batch.dry_id, batchId]
  );
  if (runningBatchResult.rows[0].total > 0) {
    throw new HttpError(409, "CONFLICT", "Dryer already has another running batch");
  }

  const dryerStatusResult = await query(`SELECT status FROM Dryer WHERE dry_id = $1`, [batch.dry_id]);
  const dryerStatus = dryerStatusResult.rows[0];
  if (!dryerStatus || dryerStatus.status !== "Idle") {
    throw new HttpError(409, "CONFLICT", "Dryer must be Idle before starting batch");
  }

  await query(`UPDATE batch SET status = 'running', start_time = NOW(), elapsed_seconds = 0 WHERE batch_id = $1`, [batchId]);
  await query(`UPDATE Dryer SET status = 'Running' WHERE dry_id = $1`, [batch.dry_id]);
  await writeLog({ logStyle: "batch_start", message: `Batch ${batchId} started`, batchId, appUserId: req.user.id });

  if (batch.operation_mode === "scheduled") {
    const firstPhaseResult = await query(
      `SELECT phase_id FROM phase WHERE recipe_id = $1 ORDER BY phase_order LIMIT 1`,
      [batch.recipe_id]
    );
    if (firstPhaseResult.rows.length) {
      await executePhaseActions(batchId, firstPhaseResult.rows[0].phase_id, batch.dry_id);
    }
  }

  return ok(res, { message: "Batch started" });
}));

router.post("/batches/:id/pause", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const batchResult = await query(`SELECT batch_id, status, dry_id FROM batch WHERE batch_id = $1`, [batchId]);
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  if (batch.status !== "running") {
    throw new HttpError(409, "CONFLICT", "Only running batch can be paused");
  }

  await query(`UPDATE batch SET status = 'paused', elapsed_seconds = COALESCE(elapsed_seconds, 0) + FLOOR(EXTRACT(EPOCH FROM NOW() - start_time))::int, start_time = NULL WHERE batch_id = $1`, [batchId]);
  await query(`UPDATE Dryer SET status = 'Stopped' WHERE dry_id = $1`, [batch.dry_id]);
  await writeLog({ logStyle: "batch_pause", message: `Batch ${batchId} paused`, batchId, appUserId: req.user.id });
  return ok(res, { message: "Batch paused" });
}));

router.post("/batches/:id/resume", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const batchResult = await query(`SELECT batch_id, status, dry_id, recipe_id FROM batch WHERE batch_id = $1`, [batchId]);
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  if (batch.status !== "paused") {
    throw new HttpError(409, "CONFLICT", "Only paused batch can be resumed");
  }

  const runningBatchResult = await query(
    `SELECT COUNT(*)::int AS total FROM batch WHERE dry_id = $1 AND status = 'running' AND batch_id != $2`,
    [batch.dry_id, batchId]
  );
  if (runningBatchResult.rows[0].total > 0) {
    throw new HttpError(409, "CONFLICT", "Dryer already has another running batch");
  }

  const dryerStatusResult = await query(`SELECT status FROM Dryer WHERE dry_id = $1`, [batch.dry_id]);
  const dryerStatus = dryerStatusResult.rows[0];
  if (!dryerStatus || (dryerStatus.status !== "Idle" && dryerStatus.status !== "Stopped" && dryerStatus.status !== "Running")) {
    throw new HttpError(409, "CONFLICT", "Dryer must be Idle, Stopped, or Running before resuming batch");
  }

  await query(`UPDATE batch SET status = 'running', start_time = NOW() WHERE batch_id = $1`, [batchId]);
  await query(`UPDATE Dryer SET status = 'Running' WHERE dry_id = $1`, [batch.dry_id]);
  await writeLog({ logStyle: "batch_resume", message: `Batch ${batchId} resumed`, batchId, appUserId: req.user.id });

  return ok(res, { message: "Batch resumed" });
}));

router.post("/batches/:id/abort", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const batchResult = await query(`SELECT batch_id, status, dry_id FROM batch WHERE batch_id = $1`, [batchId]);
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  if (["completed", "aborted"].includes(batch.status)) {
    throw new HttpError(409, "CONFLICT", "Cannot abort a batch that is already finished");
  }

  await query(`UPDATE batch SET status = 'aborted', end_time = NOW() WHERE batch_id = $1`, [batchId]);
  await query(`UPDATE Dryer SET status = 'Idle' WHERE dry_id = $1`, [batch.dry_id]);
  await writeLog({ logStyle: "batch_abort", message: `Batch ${batchId} aborted`, batchId, appUserId: req.user.id });
  return ok(res, { message: "Batch aborted" });
}));

router.post("/batches/:id/stop", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const finalStatus = req.body.final_status;
  ensureEnum(finalStatus, ["completed", "aborted"], "final_status");
  const batchResult = await query(`SELECT batch_id, status, dry_id FROM batch WHERE batch_id = $1`, [batchId]);
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  if (batch.status !== "running") {
    throw new HttpError(409, "CONFLICT", "Only running batch can be stopped");
  }

  await query(`UPDATE batch SET status = $1, end_time = NOW() WHERE batch_id = $2`, [finalStatus, batchId]);
  await query(`UPDATE Dryer SET status = 'Idle' WHERE dry_id = $1`, [batch.dry_id]);
  await writeLog({ logStyle: "batch_end", message: `Batch ${batchId} stopped with status ${finalStatus}`, batchId, appUserId: req.user.id });
  return ok(res, { message: "Batch stopped" });
}));

router.post("/batches/:id/toggle-threshold", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const boolValue = parseBool(req.body.threshold_enabled);
  if (boolValue == null) throw new HttpError(400, "VALIDATION_ERROR", "threshold_enabled must be boolean");
  const batchResult = await query(`SELECT batch_id, dry_id FROM batch WHERE batch_id = $1`, [batchId]);
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  await query(`UPDATE batch SET threshold_enabled = $1 WHERE batch_id = $2`, [boolValue, batchId]);
  return ok(res, { message: "Threshold option updated", threshold_enabled: boolValue });
}));

router.post("/batches/:id/controls/:controlId/commands", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const controlId = Number(req.params.controlId);
  const { action_type } = req.body;
  ensureEnum(action_type, ["activate", "deactivate"], "action_type");

  const batchResult = await query(
    `SELECT batch_id, dry_id, operation_mode, status FROM batch WHERE batch_id = $1`,
    [batchId]
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  if (batch.operation_mode !== "manual") throw new HttpError(422, "BUSINESS_RULE_VIOLATION", "Manual control only available in manual mode");
  if (batch.status !== "running") throw new HttpError(422, "BUSINESS_RULE_VIOLATION", "Batch must be running");

  const controlResult = await query(
    `SELECT control_id, control_type FROM control_device WHERE control_id = $1 AND dry_id = $2`,
    [controlId, batch.dry_id]
  );
  const control = controlResult.rows[0];
  if (!control) throw new HttpError(404, "NOT_FOUND", "Control device not found in this dryer");
  const status = action_type === "activate" ? "active" : "inactive";
  await query(`UPDATE control_device SET status = $1 WHERE control_id = $2`, [status, controlId]);
  await writeLog({ logStyle: "device_action", message: `Manual action ${action_type} on control ${controlId}`, batchId, controlId, appUserId: req.user.id });
  publishControlState(batch.dry_id, controlId, status);
  return ok(res, { message: "Command executed", control_id: controlId, status });
}));

// --- Sensor Data Ingestion ---
router.post("/sensor-data", requireAdmin, asyncHandler(async (req, res) => {
  const { sensor_id, value } = req.body;
  if (sensor_id == null || value == null || Number.isNaN(Number(value))) {
    throw new HttpError(400, "VALIDATION_ERROR", "sensor_id and numeric value are required");
  }
  const result = await ingestSensorValue(Number(sensor_id), Number(value), "api");
  return ok(res, result);
}));

module.exports = router;
