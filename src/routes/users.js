const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const HttpError = require("../utils/httpError");
const { ok, parseBool, ensureOneScope } = require("../utils/routeHelpers");
const { requireAdmin } = require("../middleware/auth");
const { writeLog } = require("../services/logService");

const router = express.Router();

router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { is_admin, is_active, email } = req.query;
    const result = await query(
      `SELECT app_user_id, app_user_name, email, is_admin, is_active, created_at
       FROM app_user
       WHERE ($1::text IS NULL OR email LIKE '%' || $1 || '%')
         AND ($2::boolean IS NULL OR is_admin = $2)
         AND ($3::boolean IS NULL OR is_active = $3)
       ORDER BY app_user_id DESC`,
      [email || null, parseBool(is_admin), parseBool(is_active)]
    );
    return ok(res, result.rows);
  })
);

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { app_user_name, email, password, is_admin } = req.body;
    if (!app_user_name || !email || !password) {
      throw new HttpError(400, "VALIDATION_ERROR", "app_user_name, email, password are required");
    }
    const hashed = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO app_user (app_user_name, email, password_hash, is_admin)
       VALUES ($1, $2, $3, $4)
       RETURNING app_user_id, app_user_name, email, is_admin, is_active`,
      [app_user_name, email, hashed, Boolean(is_admin)]
    );
    await writeLog({ logStyle: "audit_config_change", message: `Admin ${req.user.email} created user ${email}`, appUserId: req.user.id });
    return res.status(201).json({ status: "success", data: result.rows[0] });
  })
);

router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const { app_user_name, is_admin, is_active } = req.body;
    await query(
      `UPDATE app_user
       SET app_user_name = COALESCE($1, app_user_name),
           is_admin = COALESCE($2, is_admin),
           is_active = COALESCE($3, is_active)
       WHERE app_user_id = $4`,
      [app_user_name || null, parseBool(is_admin), parseBool(is_active), userId]
    );
    await writeLog({ logStyle: "audit_permission_change", message: `Admin ${req.user.email} updated user ${userId}`, appUserId: req.user.id });
    return ok(res, { message: "User updated" });
  })
);

router.post(
  "/:id/scopes",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    ensureOneScope(req.body);
    const result = await query(
      `INSERT INTO user_scope (app_user_id, area_id, dry_id)
       VALUES ($1, $2, $3)
       RETURNING scope_id, app_user_id, area_id, dry_id`,
      [userId, req.body.area_id ?? null, req.body.dry_id ?? null]
    );
    await writeLog({ logStyle: "audit_permission_change", message: `Admin ${req.user.email} granted scope to user ${userId}`, appUserId: req.user.id });
    return res.status(201).json({ status: "success", data: result.rows[0] });
  })
);

router.get(
  "/:id/scopes",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT scope_id, area_id, dry_id FROM user_scope WHERE app_user_id = $1`,
      [Number(req.params.id)]
    );
    return ok(res, result.rows);
  })
);

router.delete(
  "/:id/scopes/:scopeId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await query(
      `DELETE FROM user_scope WHERE app_user_id = $1 AND scope_id = $2`,
      [Number(req.params.id), Number(req.params.scopeId)]
    );
    return ok(res, { message: "Scope deleted" });
  })
);

module.exports = router;
