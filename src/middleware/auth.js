const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { query } = require("../config/db");
const HttpError = require("../utils/httpError");

async function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new HttpError(401, "UNAUTHORIZED", "Missing or invalid token"));
  }

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    const result = await query(
      `SELECT app_user_id, app_user_name, email, is_admin, is_active
       FROM app_user
       WHERE app_user_id = $1`,
      [payload.sub]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return next(new HttpError(401, "UNAUTHORIZED", "User inactive or not found"));
    }

    req.user = {
      id: user.app_user_id,
      name: user.app_user_name,
      email: user.email,
      isAdmin: Boolean(user.is_admin),
    };

    return next();
  } catch (error) {
    return next(new HttpError(401, "UNAUTHORIZED", "Invalid or expired token"));
  }
}

function requireAdmin(req, _res, next) {
  if (!req.user || !req.user.isAdmin) {
    return next(new HttpError(403, "FORBIDDEN", "Admin permission required"));
  }
  return next();
}

module.exports = {
  authenticate,
  requireAdmin,
};
