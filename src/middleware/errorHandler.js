const HttpError = require("../utils/httpError");

function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, "NOT_FOUND", "Endpoint not found"));
}

function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || "SERVER_ERROR";
  const message = err.message || "Internal server error";

  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(statusCode).json({
    status: "error",
    code,
    message,
    errors: err.errors || [],
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
