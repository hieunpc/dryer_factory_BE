const express = require("express");
const { query } = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const HttpError = require("../utils/httpError");
const { ok, ensureEnum } = require("../utils/routeHelpers");
const { requireAdmin } = require("../middleware/auth");
const { getAccessibleDryerIds, inClauseFromIds } = require("../services/scopeService");

const router = express.Router();

// --- Logs ---
router.get("/logs", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `b.dry_id IN ${inClauseFromIds(dryerIds)}`;
  const { batch_id, dry_id, log_style, from, to } = req.query;
  const result = await query(
    `SELECT l.log_id, l.log_style, l.message, l.created_at, l.batch_id, l.sensor_id, l.control_id, l.app_user_id, l.value
     FROM log l LEFT JOIN batch b ON b.batch_id = l.batch_id
     WHERE (${scopeClause} OR l.batch_id IS NULL)
       AND ($1::int IS NULL OR l.batch_id = $1)
       AND ($2::int IS NULL OR b.dry_id = $2)
       AND ($3::text IS NULL OR l.log_style = $3)
       AND ($4::timestamptz IS NULL OR l.created_at >= $4)
       AND ($5::timestamptz IS NULL OR l.created_at <= $5)
     ORDER BY l.log_id DESC`,
    [batch_id ? Number(batch_id) : null, dry_id ? Number(dry_id) : null, log_style || null,
     from ? new Date(from) : null, to ? new Date(to) : null]
  );
  return ok(res, result.rows);
}));

router.get("/logs/audit", requireAdmin, asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT log_id, log_style, message, created_at, app_user_id FROM log
     WHERE log_style IN ('audit_login', 'audit_permission_change', 'audit_config_change')
     ORDER BY log_id DESC`
  );
  return ok(res, result.rows);
}));

// --- Dashboard ---
router.get("/dashboard/overview", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) {
    return ok(res, { running_dryers: 0, idle_dryers: 0, maintenance_dryers: 0, running_batches: 0, completed_batches: 0, failed_batches: 0, threshold_alert_rate: 0 });
  }
  const scopeDryers = req.user.isAdmin ? null : inClauseFromIds(dryerIds);
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;

  const dryerStatQ = req.user.isAdmin
    ? `SELECT SUM(CASE WHEN status='Running' THEN 1 ELSE 0 END)::int AS running_dryers,
              SUM(CASE WHEN status='Idle' THEN 1 ELSE 0 END)::int AS idle_dryers,
              SUM(CASE WHEN status='Maintenance' THEN 1 ELSE 0 END)::int AS maintenance_dryers FROM Dryer`
    : `SELECT SUM(CASE WHEN status='Running' THEN 1 ELSE 0 END)::int AS running_dryers,
              SUM(CASE WHEN status='Idle' THEN 1 ELSE 0 END)::int AS idle_dryers,
              SUM(CASE WHEN status='Maintenance' THEN 1 ELSE 0 END)::int AS maintenance_dryers
       FROM Dryer WHERE dry_id IN ${scopeDryers}`;
  const dryerStats = await query(dryerStatQ);

  const batchStatQ = req.user.isAdmin
    ? `SELECT SUM(CASE WHEN status='running' THEN 1 ELSE 0 END)::int AS running_batches,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed_batches,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed_batches
       FROM batch WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at <= $2)`
    : `SELECT SUM(CASE WHEN status='running' THEN 1 ELSE 0 END)::int AS running_batches,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed_batches,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed_batches
       FROM batch WHERE dry_id IN ${scopeDryers}
         AND ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at <= $2)`;
  const batchStats = await query(batchStatQ, [from, to]);

  const alertQ = req.user.isAdmin
    ? `SELECT CAST(SUM(CASE WHEN log_style='sensor_trigger' THEN 1 ELSE 0 END) AS FLOAT)
         / NULLIF(COUNT(*)::float, 0) AS threshold_alert_rate
       FROM log WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at <= $2)`
    : `SELECT CAST(SUM(CASE WHEN l.log_style='sensor_trigger' THEN 1 ELSE 0 END) AS FLOAT)
         / NULLIF(COUNT(*)::float, 0) AS threshold_alert_rate
       FROM log l LEFT JOIN batch b ON b.batch_id = l.batch_id
       WHERE (b.dry_id IN ${scopeDryers} OR l.batch_id IS NULL)
         AND ($1::timestamptz IS NULL OR l.created_at >= $1) AND ($2::timestamptz IS NULL OR l.created_at <= $2)`;
  const alertStats = await query(alertQ, [from, to]);

  return ok(res, {
    ...(dryerStats.rows[0] || {}),
    ...(batchStats.rows[0] || {}),
    threshold_alert_rate: alertStats.rows[0]?.threshold_alert_rate || 0,
  });
}));

router.get("/dashboard/charts/temperature-humidity", asyncHandler(async (req, res) => {
  const { batch_id, dry_id, from, to } = req.query;
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `s.dry_id IN ${inClauseFromIds(dryerIds)}`;
  const result = await query(
    `SELECT l.created_at, l.value, sd.sensor_type, l.sensor_id, b.batch_id
     FROM log l JOIN sensor_device sd ON sd.sensor_id = l.sensor_id
     JOIN sensor_device s ON s.sensor_id = l.sensor_id
     LEFT JOIN batch b ON b.batch_id = l.batch_id
     WHERE l.log_style = 'parameter_change' AND ${scopeClause}
       AND ($1::int IS NULL OR b.batch_id = $1)
       AND ($2::int IS NULL OR s.dry_id = $2)
       AND ($3::timestamptz IS NULL OR l.created_at >= $3)
       AND ($4::timestamptz IS NULL OR l.created_at <= $4)
       AND sd.sensor_type IN ('temperature', 'humidity')
     ORDER BY l.created_at`,
    [batch_id ? Number(batch_id) : null, dry_id ? Number(dry_id) : null,
     from ? new Date(from) : null, to ? new Date(to) : null]
  );
  return ok(res, result.rows);
}));

router.get("/dashboard/charts/device-utilization", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `cd.dry_id IN ${inClauseFromIds(dryerIds)}`;
  const result = await query(
    `SELECT cd.control_id, cd.control_name, cd.control_type,
            SUM(CASE WHEN l.message LIKE '%-> active%' THEN 1 ELSE 0 END)::int AS activate_count,
            SUM(CASE WHEN l.message LIKE '%-> inactive%' THEN 1 ELSE 0 END)::int AS deactivate_count
     FROM control_device cd LEFT JOIN log l ON l.control_id = cd.control_id AND l.log_style = 'device_action'
     WHERE ${scopeClause}
     GROUP BY cd.control_id, cd.control_name, cd.control_type ORDER BY cd.control_id`
  );
  return ok(res, result.rows);
}));

// --- Reports ---
router.get("/reports/operations", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `dry_id IN ${inClauseFromIds(dryerIds)}`;
  const result = await query(
    `SELECT created_at::date AS report_date, COUNT(*)::int AS total_batches,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed_batches,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed_batches,
            SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END)::int AS cancelled_batches
     FROM batch WHERE ${scopeClause}
     GROUP BY created_at::date ORDER BY report_date DESC`
  );
  return ok(res, result.rows);
}));

router.get("/reports/quality", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `b.dry_id IN ${inClauseFromIds(dryerIds)}`;
  const result = await query(
    `SELECT b.batch_id, b.dry_id,
            AVG(CASE WHEN sd.sensor_type='temperature' THEN l.value END) AS avg_temperature,
            AVG(CASE WHEN sd.sensor_type='humidity' THEN l.value END) AS avg_humidity,
            SUM(CASE WHEN l.log_style='device_action' AND l.message LIKE 'Manual action%' THEN 1 ELSE 0 END)::int AS manual_actions
     FROM batch b LEFT JOIN log l ON l.batch_id = b.batch_id LEFT JOIN sensor_device sd ON sd.sensor_id = l.sensor_id
     WHERE ${scopeClause} GROUP BY b.batch_id, b.dry_id ORDER BY b.batch_id DESC`
  );
  return ok(res, result.rows);
}));

router.get("/reports/incidents", asyncHandler(async (req, res) => {
  const dryerIds = req.user.isAdmin ? null : await getAccessibleDryerIds(req.user);
  if (!req.user.isAdmin && !dryerIds.length) return ok(res, []);
  const scopeClause = req.user.isAdmin ? "1=1" : `b.dry_id IN ${inClauseFromIds(dryerIds)}`;
  const result = await query(
    `SELECT l.created_at::date AS report_date,
            SUM(CASE WHEN l.log_style='sensor_trigger' THEN 1 ELSE 0 END)::int AS threshold_triggers,
            SUM(CASE WHEN l.log_style='device_action' THEN 1 ELSE 0 END)::int AS device_actions
     FROM log l LEFT JOIN batch b ON b.batch_id = l.batch_id
     WHERE (${scopeClause} OR l.batch_id IS NULL)
     GROUP BY l.created_at::date ORDER BY report_date DESC`
  );
  return ok(res, result.rows);
}));

router.get("/reports/performance", requireAdmin, asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT d.dry_id, d.dry_name, COUNT(b.batch_id)::int AS total_batches,
            SUM(CASE WHEN b.status='completed' THEN 1 ELSE 0 END)::int AS completed_batches,
            AVG(CASE WHEN b.start_time IS NOT NULL AND b.end_time IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (b.end_time - b.start_time)) END)::int AS avg_duration_seconds
     FROM Dryer d LEFT JOIN batch b ON b.dry_id = d.dry_id
     GROUP BY d.dry_id, d.dry_name ORDER BY d.dry_id`
  );
  return ok(res, result.rows);
}));

router.post("/reports/export", asyncHandler(async (req, res) => {
  const { report_type, file_format, filters } = req.body;
  if (!report_type || !file_format) throw new HttpError(400, "VALIDATION_ERROR", "report_type and file_format are required");
  ensureEnum(file_format, ["pdf", "xlsx"], "file_format");
  const result = await query(
    `INSERT INTO report_export (app_user_id, report_type, file_format, filter_json)
     VALUES ($1, $2, $3, $4)
     RETURNING export_id, report_type, file_format, created_at`,
    [req.user.id, report_type, file_format, filters ? JSON.stringify(filters) : null]
  );
  const row = result.rows[0];
  return res.status(202).json({
    status: "success",
    data: { export_id: row.export_id, report_type: row.report_type, file_format: row.file_format, created_at: row.created_at,
            download_url: `/api/v1/reports/export/${row.export_id}/download` },
  });
}));

router.get("/reports/export/:exportId/download", asyncHandler(async (req, res) => {
  const exportId = Number(req.params.exportId);
  const result = await query(
    `SELECT export_id, app_user_id, report_type, file_format, filter_json, created_at
     FROM report_export WHERE export_id = $1`,
    [exportId]
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "NOT_FOUND", "Export record not found");
  if (!req.user.isAdmin && row.app_user_id !== req.user.id) throw new HttpError(403, "FORBIDDEN", "No access to export file");
  return ok(res, {
    export_id: row.export_id, report_type: row.report_type, file_format: row.file_format,
    filters: row.filter_json ? JSON.parse(row.filter_json) : null, created_at: row.created_at,
    message: "File generation/storage integration is pending. Implement object storage here.",
  });
}));

module.exports = router;
