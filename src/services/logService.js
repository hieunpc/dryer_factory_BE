const { query } = require("../config/db");

async function writeLog({
  logStyle,
  message,
  batchId = null,
  sensorId = null,
  controlId = null,
  appUserId = null,
  value = null,
}) {
  await query(
    `INSERT INTO log (log_style, message, batch_id, sensor_id, control_id, app_user_id, value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [logStyle, message, batchId, sensorId, controlId, appUserId, value]
  );
}

module.exports = {
  writeLog,
};
