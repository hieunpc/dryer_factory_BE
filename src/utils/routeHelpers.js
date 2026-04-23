const HttpError = require("./httpError");

function ok(res, data) {
  return res.json({ status: "success", data });
}

function parseBool(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function ensureEnum(value, values, fieldName) {
  if (!values.includes(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${fieldName} must be one of: ${values.join(", ")}`);
  }
}

function ensureOneScope(body) {
  const keys = ["area_id", "dry_id"].filter((k) => body[k] != null);
  if (keys.length !== 1) {
    throw new HttpError(400, "VALIDATION_ERROR", "Exactly one of area_id, dry_id is required");
  }
}

module.exports = { ok, parseBool, ensureEnum, ensureOneScope };
