const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { query } = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const HttpError = require("../utils/httpError");
const { ok } = require("../utils/routeHelpers");
const { writeLog } = require("../services/logService");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new HttpError(400, "VALIDATION_ERROR", "email and password are required");
    }

    const result = await query(
      `SELECT app_user_id, app_user_name, email, password_hash, is_admin, is_active
       FROM app_user WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid credentials");
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid credentials");
    }

    const token = jwt.sign({ sub: user.app_user_id, is_admin: Boolean(user.is_admin) }, env.jwt.secret, {
      expiresIn: env.jwt.expiresIn,
    });

    await writeLog({ logStyle: "audit_login", message: `User ${user.email} login success`, appUserId: user.app_user_id });

    return ok(res, {
      access_token: token,
      expires_in: env.jwt.expiresIn,
      user: {
        app_user_id: user.app_user_id,
        app_user_name: user.app_user_name,
        email: user.email,
        is_admin: Boolean(user.is_admin),
      },
    });
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const scopes = await query(
      `SELECT scope_id, area_id, dry_id FROM user_scope WHERE app_user_id = $1`,
      [req.user.id]
    );
    return ok(res, { user: req.user, scopes: scopes.rows });
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (_req, res) => {
    return ok(res, { message: "Logged out" });
  })
);

module.exports = router;
