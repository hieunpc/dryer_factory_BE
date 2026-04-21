const express = require("express");
const { query } = require("../config/db");
const { publishControlState } = require("../config/mqtt");
const asyncHandler = require("../utils/asyncHandler");
const HttpError = require("../utils/httpError");
const { ok, parseBool, ensureEnum } = require("../utils/routeHelpers");
const { requireAdmin } = require("../middleware/auth");
const { writeLog } = require("../services/logService");
const { ingestSensorValue } = require("../services/sensorService");
const { getAccessibleDryerIds, ensureDryerAccess, inClauseFromIds } = require("../services/scopeService");

const router = express.Router();

router.post("/batches", asyncHandler(async (req, res) => {
  const { dry_id, fruit_id, recipe_id, operation_mode, threshold_enabled = false, is_customize = false } = req.body;
  if (!dry_id || !fruit_id || !recipe_id || !operation_mode) {
    throw new HttpError(400, "VALIDATION_ERROR", "dry_id, fruit_id, recipe_id, operation_mode are required");
  }
  ensureEnum(operation_mode, ["manual", "scheduled"], "operation_mode");
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

  const result = await query(
    `INSERT INTO batch (status, operation_mode, threshold_enabled, is_customize, dry_id, fruit_id, recipe_id, app_user_id)
     VALUES ('pending', $1, $2, $3, $4, $5, $6, $7)
     RETURNING batch_id, status, operation_mode, threshold_enabled, is_customize, dry_id, fruit_id, recipe_id, app_user_id, created_at`,
    [operation_mode, Boolean(threshold_enabled), Boolean(is_customize), Number(dry_id), Number(fruit_id), Number(recipe_id), req.user.id]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.get("/batches", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `b.dry_id IN ${inClauseFromIds(dryerIds)}`;
  const result = await query(
    `SELECT b.batch_id, b.start_time, b.end_time, b.status, b.operation_mode, b.threshold_enabled,
            b.is_customize, b.dry_id, b.fruit_id, b.recipe_id, b.app_user_id, b.created_at
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
            is_customize, dry_id, fruit_id, recipe_id, app_user_id, created_at
     FROM batch WHERE batch_id = $1`,
    [batchId]
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  const phases = await query(
    `SELECT phase_id, phase_order, duration_seconds, humidity, temperature
     FROM phase WHERE recipe_id = $1 ORDER BY phase_order`,
    [batch.recipe_id]
  );
  const controls = await query(
    `SELECT control_id, control_name, control_type, status FROM control_device
     WHERE dry_id = $1 ORDER BY control_id`,
    [batch.dry_id]
  );
  return ok(res, { ...batch, phases: phases.rows, controls: controls.rows });
}));

router.post("/batches/:id/start", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const batchResult = await query(`SELECT batch_id, status, dry_id FROM batch WHERE batch_id = $1`, [batchId]);
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
  if (batch.status !== "pending") throw new HttpError(409, "CONFLICT", "Only pending batch can be started");

  await query(`UPDATE batch SET status = 'running', start_time = NOW() WHERE batch_id = $1`, [batchId]);
  await query(`UPDATE Dryer SET status = 'Running' WHERE dry_id = $1`, [batch.dry_id]);
  await writeLog({ logStyle: "batch_start", message: `Batch ${batchId} started`, batchId, appUserId: req.user.id });
  return ok(res, { message: "Batch started" });
}));

router.post("/batches/:id/stop", asyncHandler(async (req, res) => {
  const batchId = Number(req.params.id);
  const finalStatus = req.body.final_status;
  ensureEnum(finalStatus, ["completed", "cancelled"], "final_status");
  const batchResult = await query(`SELECT batch_id, status, dry_id FROM batch WHERE batch_id = $1`, [batchId]);
  const batch = batchResult.rows[0];
  if (!batch) throw new HttpError(404, "NOT_FOUND", "Batch not found");
  const allowed = await ensureDryerAccess(req.user, batch.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to batch");
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
  publishControlState(control.control_type, { control_id: controlId, status, source: "manual", batch_id: batchId });
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
