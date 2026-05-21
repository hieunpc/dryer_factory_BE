const express = require("express");
const { query } = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const HttpError = require("../utils/httpError");
const { ok, ensureEnum } = require("../utils/routeHelpers");
const { requireAdmin } = require("../middleware/auth");
const { getAccessibleDryerIds, ensureDryerAccess, inClauseFromIds } = require("../services/scopeService");

const router = express.Router();

router.get("/areas", asyncHandler(async (req, res) => {
  if (req.user.isAdmin) {
    const result = await query(
      `SELECT area_id, area_name, created_at FROM Area
       ORDER BY area_id`
    );
    return ok(res, result.rows);
  }
  const dryerIds = await getAccessibleDryerIds(req.user);
  if (!dryerIds.length) return ok(res, []);
  const result = await query(
    `SELECT DISTINCT a.area_id, a.area_name, a.created_at
     FROM Area a JOIN Dryer d ON d.area_id = a.area_id
     WHERE d.dry_id IN ${inClauseFromIds(dryerIds)}
     ORDER BY a.area_id`
  );
  return ok(res, result.rows);
}));

router.get("/areas/:id", asyncHandler(async (req, res) => {
  const areaId = Number(req.params.id);
  const result = await query(
    `SELECT area_id, area_name, created_at FROM Area WHERE area_id = $1`,
    [areaId]
  );
  const area = result.rows[0];
  if (!area) throw new HttpError(404, "NOT_FOUND", "Area not found");
  
  // Check access for non-admin users
  if (!req.user.isAdmin) {
    const dryerIds = await getAccessibleDryerIds(req.user);
    const hasAccess = dryerIds.length > 0 && (await query(
      `SELECT 1 FROM Dryer WHERE area_id = $1 AND dry_id = ANY($2::int[]) LIMIT 1`,
      [areaId, dryerIds]
    )).rows.length > 0;
    if (!hasAccess) throw new HttpError(403, "FORBIDDEN", "No access to this area");
  }
  
  return ok(res, area);
}));

router.post("/areas", requireAdmin, asyncHandler(async (req, res) => {
  const { area_name } = req.body;
  if (!area_name) throw new HttpError(400, "VALIDATION_ERROR", "area_name is required");
  const result = await query(
    `INSERT INTO Area (area_name) VALUES ($1)
     RETURNING area_id, area_name, created_at`,
    [area_name]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.patch("/areas/:id", requireAdmin, asyncHandler(async (req, res) => {
  const areaId = Number(req.params.id);
  const { area_name } = req.body;
  
  const existingArea = await query(
    `SELECT area_id FROM Area WHERE area_id = $1`,
    [areaId]
  );
  if (!existingArea.rows.length) throw new HttpError(404, "NOT_FOUND", "Area not found");
  
  await query(
    `UPDATE Area SET area_name = COALESCE($1, area_name) WHERE area_id = $2`,
    [area_name || null, areaId]
  );
  return ok(res, { message: "Area updated" });
}));

router.delete("/areas/:id", requireAdmin, asyncHandler(async (req, res) => {
  const areaId = Number(req.params.id);
  
  const existingArea = await query(
    `SELECT area_id FROM Area WHERE area_id = $1`,
    [areaId]
  );
  if (!existingArea.rows.length) throw new HttpError(404, "NOT_FOUND", "Area not found");
  
  // Check if area has dryers
  const dryersInArea = await query(
    `SELECT COUNT(*)::int AS count FROM Dryer WHERE area_id = $1`,
    [areaId]
  );
  if (dryersInArea.rows[0].count > 0) {
    throw new HttpError(409, "CONFLICT", "Cannot delete area with existing dryers");
  }
  
  await query(`DELETE FROM Area WHERE area_id = $1`, [areaId]);
  return ok(res, { message: "Area deleted" });
}));

// --- Dryers ---
router.get("/dryers", asyncHandler(async (req, res) => {
  const areaId = req.query.area_id ? Number(req.query.area_id) : null;
  const status = req.query.status || null;
  if (status) ensureEnum(status, ["Running", "Idle", "Maintenance", "Stopped"], "status");

  if (req.user.isAdmin) {
    const result = await query(
      `SELECT dry_id, dry_name, status, area_id, created_at FROM Dryer
       WHERE ($1::int IS NULL OR area_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY dry_id`,
      [areaId, status]
    );
    return ok(res, result.rows);
  }
  const dryerIds = await getAccessibleDryerIds(req.user);
  if (!dryerIds.length) return ok(res, []);
  const result = await query(
    `SELECT dry_id, dry_name, status, area_id, created_at FROM Dryer
     WHERE dry_id IN ${inClauseFromIds(dryerIds)}
       AND ($1::int IS NULL OR area_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY dry_id`,
    [areaId, status]
  );
  return ok(res, result.rows);
}));

router.get("/dryers/:id", asyncHandler(async (req, res) => {
  const dryId = Number(req.params.id);
  const allowed = await ensureDryerAccess(req.user, dryId);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to dryer");

  const dryerResult = await query(
    `SELECT dry_id, dry_name, status, area_id, created_at FROM Dryer WHERE dry_id = $1`,
    [dryId]
  );
  const dryer = dryerResult.rows[0];
  if (!dryer) throw new HttpError(404, "NOT_FOUND", "Dryer not found");

  const sensors = await query(
    `SELECT sd.sensor_id, sd.sensor_type, sd.threshold, sl.last_value, sl.updated_at
     FROM sensor_device sd LEFT JOIN sensor_latest sl ON sl.sensor_id = sd.sensor_id
     WHERE sd.dry_id = $1 ORDER BY sd.sensor_id`,
    [dryId]
  );
  const controls = await query(
    `SELECT control_id, control_name, control_type, status FROM control_device
     WHERE dry_id = $1 ORDER BY control_id`,
    [dryId]
  );
  return ok(res, { ...dryer, sensors: sensors.rows, controls: controls.rows });
}));

router.post("/dryers", requireAdmin, asyncHandler(async (req, res) => {
  const { dry_name, status = "Idle", area_id } = req.body;
  if (!dry_name || !area_id) throw new HttpError(400, "VALIDATION_ERROR", "dry_name and area_id are required");
  ensureEnum(status, ["Running", "Idle", "Maintenance", "Stopped"], "status");
  const result = await query(
    `INSERT INTO Dryer (dry_name, status, area_id) VALUES ($1, $2, $3)
     RETURNING dry_id, dry_name, status, area_id`,
    [dry_name, status, Number(area_id)]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.patch("/dryers/:id", requireAdmin, asyncHandler(async (req, res) => {
  const dryId = Number(req.params.id);
  const { dry_name, status, area_id } = req.body;
  if (status) ensureEnum(status, ["Running", "Idle", "Maintenance", "Stopped"], "status");
  await query(
    `UPDATE Dryer SET dry_name = COALESCE($1, dry_name), status = COALESCE($2, status),
       area_id = COALESCE($3, area_id) WHERE dry_id = $4`,
    [dry_name || null, status || null, area_id ? Number(area_id) : null, dryId]
  );
  return ok(res, { message: "Dryer updated" });
}));

router.delete("/dryers/:id", requireAdmin, asyncHandler(async (req, res) => {
  const dryId = Number(req.params.id);
  
  const existingDryer = await query(
    `SELECT dry_id FROM Dryer WHERE dry_id = $1`,
    [dryId]
  );
  if (!existingDryer.rows.length) throw new HttpError(404, "NOT_FOUND", "Dryer not found");
  
  // Check if dryer has running batches
  const runningBatches = await query(
    `SELECT COUNT(*)::int AS count FROM batch WHERE dry_id = $1 AND status = 'running'`,
    [dryId]
  );
  if (runningBatches.rows[0].count > 0) {
    throw new HttpError(409, "CONFLICT", "Cannot delete dryer with running batches");
  }
  
  // Delete associated sensors, controls, and scopes
  await query(`DELETE FROM sensor_device WHERE dry_id = $1`, [dryId]);
  await query(`DELETE FROM control_device WHERE dry_id = $1`, [dryId]);
  await query(`DELETE FROM Dryer WHERE dry_id = $1`, [dryId]);
  
  return ok(res, { message: "Dryer deleted" });
}));

// --- Sensors ---
router.get("/sensors", asyncHandler(async (req, res) => {
  const dryId = req.query.dry_id ? Number(req.query.dry_id) : null;
  
  if (req.user.isAdmin) {
    const result = await query(
      `SELECT sd.sensor_id, sd.sensor_type, sd.threshold, sd.dry_id, sl.last_value, sl.updated_at
       FROM sensor_device sd
       LEFT JOIN sensor_latest sl ON sl.sensor_id = sd.sensor_id
       WHERE ($1::int IS NULL OR sd.dry_id = $1)
       ORDER BY sd.sensor_id`,
      [dryId]
    );
    return ok(res, result.rows);
  }
  
  const dryerIds = await getAccessibleDryerIds(req.user);
  if (!dryerIds.length) return ok(res, []);
  
  const result = await query(
    `SELECT sd.sensor_id, sd.sensor_type, sd.threshold, sd.dry_id, sl.last_value, sl.updated_at
     FROM sensor_device sd
     LEFT JOIN sensor_latest sl ON sl.sensor_id = sd.sensor_id
     WHERE sd.dry_id IN ${inClauseFromIds(dryerIds)}
       AND ($1::int IS NULL OR sd.dry_id = $1)
     ORDER BY sd.sensor_id`,
    [dryId]
  );
  return ok(res, result.rows);
}));

router.get("/sensors/:id", asyncHandler(async (req, res) => {
  const sensorId = Number(req.params.id);
  const result = await query(
    `SELECT sd.sensor_id, sd.sensor_type, sd.threshold, sd.dry_id, sl.last_value, sl.updated_at
     FROM sensor_device sd
     LEFT JOIN sensor_latest sl ON sl.sensor_id = sd.sensor_id
     WHERE sd.sensor_id = $1`,
    [sensorId]
  );
  const sensor = result.rows[0];
  if (!sensor) throw new HttpError(404, "NOT_FOUND", "Sensor not found");
  
  // Check access for non-admin users
  const allowed = await ensureDryerAccess(req.user, sensor.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to this sensor");
  
  return ok(res, sensor);
}));

router.post("/dryers/:id/sensors", requireAdmin, asyncHandler(async (req, res) => {
  const dryId = Number(req.params.id);
  const { sensor_type, threshold } = req.body;
  ensureEnum(sensor_type, ["humidity", "temperature", "door_state", "light"], "sensor_type");
  const result = await query(
    `INSERT INTO sensor_device (sensor_type, threshold, dry_id) VALUES ($1, $2, $3)
     RETURNING sensor_id, sensor_type, threshold, dry_id`,
    [sensor_type, threshold ?? null, dryId]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.patch("/sensors/:id", requireAdmin, asyncHandler(async (req, res) => {
  const { sensor_type, threshold } = req.body;
  if (sensor_type) ensureEnum(sensor_type, ["humidity", "temperature", "door_state", "light"], "sensor_type");
  await query(
    `UPDATE sensor_device SET sensor_type = COALESCE($1, sensor_type), threshold = COALESCE($2, threshold)
     WHERE sensor_id = $3`,
    [sensor_type || null, threshold ?? null, Number(req.params.id)]
  );
  return ok(res, { message: "Sensor updated" });
}));

router.delete("/sensors/:id", requireAdmin, asyncHandler(async (req, res) => {
  const sensorId = Number(req.params.id);
  
  const existingSensor = await query(
    `SELECT sensor_id FROM sensor_device WHERE sensor_id = $1`,
    [sensorId]
  );
  if (!existingSensor.rows.length) throw new HttpError(404, "NOT_FOUND", "Sensor not found");
  
  // Delete sensor data and latest values
  await query(`DELETE FROM sensor_latest WHERE sensor_id = $1`, [sensorId]);
  await query(`DELETE FROM log WHERE sensor_id = $1`, [sensorId]);
  await query(`DELETE FROM sensor_device WHERE sensor_id = $1`, [sensorId]);
  
  return ok(res, { message: "Sensor deleted" });
}));

router.get("/sensors/:id/latest", asyncHandler(async (req, res) => {
  const sensorId = Number(req.params.id);
  const sensorResult = await query(`SELECT sensor_id, dry_id FROM sensor_device WHERE sensor_id = $1`, [sensorId]);
  const sensor = sensorResult.rows[0];
  if (!sensor) throw new HttpError(404, "NOT_FOUND", "Sensor not found");
  const allowed = await ensureDryerAccess(req.user, sensor.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to sensor");
  const latest = await query(`SELECT sensor_id, last_value, updated_at FROM sensor_latest WHERE sensor_id = $1`, [sensorId]);
  return ok(res, latest.rows[0] || null);
}));

router.get("/sensors/:id/data", asyncHandler(async (req, res) => {
  const sensorId = Number(req.params.id);
  const { from, to, limit = 100 } = req.query;
  
  // Check sensor exists and user has access
  const sensorResult = await query(`SELECT sensor_id, dry_id FROM sensor_device WHERE sensor_id = $1`, [sensorId]);
  const sensor = sensorResult.rows[0];
  if (!sensor) throw new HttpError(404, "NOT_FOUND", "Sensor not found");
  const allowed = await ensureDryerAccess(req.user, sensor.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to sensor");
  
  // Get sensor data from logs
  const result = await query(
    `SELECT log_id, sensor_id, value, created_at
     FROM log 
     WHERE sensor_id = $1 
       AND log_style = 'parameter_change'
       AND ($2::timestamptz IS NULL OR created_at >= $2)
       AND ($3::timestamptz IS NULL OR created_at <= $3)
     ORDER BY created_at DESC
     LIMIT $4`,
    [
      sensorId,
      from ? new Date(from) : null,
      to ? new Date(to) : null,
      Math.min(Number(limit) || 100, 1000)
    ]
  );
  
  return ok(res, result.rows.reverse());
}));

// --- Controls ---
router.get("/controls", asyncHandler(async (req, res) => {
  const dryId = req.query.dry_id ? Number(req.query.dry_id) : null;
  const controlType = req.query.control_type || null;
  
  if (req.user.isAdmin) {
    const result = await query(
      `SELECT control_id, control_name, control_type, status, dry_id FROM control_device
       WHERE ($1::int IS NULL OR dry_id = $1)
         AND ($2::text IS NULL OR control_type = $2)
       ORDER BY control_id`,
      [dryId, controlType]
    );
    return ok(res, result.rows);
  }
  
  const dryerIds = await getAccessibleDryerIds(req.user);
  if (!dryerIds.length) return ok(res, []);
  
  const result = await query(
    `SELECT control_id, control_name, control_type, status, dry_id FROM control_device
     WHERE dry_id IN ${inClauseFromIds(dryerIds)}
       AND ($1::int IS NULL OR dry_id = $1)
       AND ($2::text IS NULL OR control_type = $2)
     ORDER BY control_id`,
    [dryId, controlType]
  );
  return ok(res, result.rows);
}));

router.get("/controls/:id", asyncHandler(async (req, res) => {
  const controlId = Number(req.params.id);
  const result = await query(
    `SELECT control_id, control_name, control_type, status, dry_id FROM control_device 
     WHERE control_id = $1`,
    [controlId]
  );
  const control = result.rows[0];
  if (!control) throw new HttpError(404, "NOT_FOUND", "Control not found");
  
  // Check access for non-admin users
  const allowed = await ensureDryerAccess(req.user, control.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to this control");
  
  return ok(res, control);
}));

router.post("/dryers/:id/controls", requireAdmin, asyncHandler(async (req, res) => {
  const dryId = Number(req.params.id);
  const { control_name, control_type, status = "inactive" } = req.body;
  ensureEnum(control_type, ["fan", "lamp"], "control_type");
  ensureEnum(status, ["active", "inactive"], "status");
  const result = await query(
    `INSERT INTO control_device (control_name, control_type, status, dry_id) VALUES ($1, $2, $3, $4)
     RETURNING control_id, control_name, control_type, status, dry_id`,
    [control_name || null, control_type, status, dryId]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.patch("/controls/:id", requireAdmin, asyncHandler(async (req, res) => {
  const { control_name, status } = req.body;
  if (status) ensureEnum(status, ["active", "inactive"], "status");
  await query(
    `UPDATE control_device SET control_name = COALESCE($1, control_name), status = COALESCE($2, status)
     WHERE control_id = $3`,
    [control_name || null, status || null, Number(req.params.id)]
  );
  return ok(res, { message: "Control updated" });
}));

router.delete("/controls/:id", requireAdmin, asyncHandler(async (req, res) => {
  const controlId = Number(req.params.id);
  
  const existingControl = await query(
    `SELECT control_id FROM control_device WHERE control_id = $1`,
    [controlId]
  );
  if (!existingControl.rows.length) throw new HttpError(404, "NOT_FOUND", "Control not found");
  
  // Delete associated phase actions and policy actions
  await query(`DELETE FROM phase_actions WHERE control_id = $1`, [controlId]);
  await query(`DELETE FROM policy_action WHERE control_id = $1`, [controlId]);
  await query(`DELETE FROM log WHERE control_id = $1`, [controlId]);
  await query(`DELETE FROM control_device WHERE control_id = $1`, [controlId]);
  
  return ok(res, { message: "Control deleted" });
}));

router.post("/controls/:id/execute", asyncHandler(async (req, res) => {
  const controlId = Number(req.params.id);
  const { value } = req.body;
  
  const controlResult = await query(
    `SELECT control_id, dry_id, status FROM control_device WHERE control_id = $1`,
    [controlId]
  );
  const control = controlResult.rows[0];
  if (!control) throw new HttpError(404, "NOT_FOUND", "Control not found");
  
  // Check access for non-admin users
  const allowed = await ensureDryerAccess(req.user, control.dry_id);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "No access to this control");
  
  // Toggle control status based on value or current state
  const newStatus = value !== undefined 
    ? (value ? "active" : "inactive")
    : (control.status === "active" ? "inactive" : "active");
  
  await query(
    `UPDATE control_device SET status = $1 WHERE control_id = $2`,
    [newStatus, controlId]
  );
  
  // Publish control state via MQTT
  const { publishControlState } = require("../config/mqtt");
  publishControlState(control.dry_id, controlId, newStatus);
  
  const { writeLog } = require("../services/logService");
  await writeLog({ 
    logStyle: "device_action", 
    message: `Control ${controlId} executed: ${newStatus}`, 
    controlId, 
    appUserId: req.user.id 
  });
  
  return ok(res, { message: "Control executed", control_id: controlId, status: newStatus });
}));

module.exports = router;
