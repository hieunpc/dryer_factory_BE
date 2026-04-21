const { query } = require("../config/db");
const { writeLog } = require("./logService");
const { publishControlState } = require("../config/mqtt");

function evalCondition(operator, left, right) {
  switch (operator) {
    case ">":
      return left > right;
    case "<":
      return left < right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case "=":
      return left === right;
    default:
      return false;
  }
}

function resolveCurrentPhase(phases, elapsedSeconds) {
  let acc = 0;
  for (const phase of phases) {
    acc += Number(phase.duration_seconds);
    if (elapsedSeconds <= acc) {
      return phase;
    }
  }
  return phases[phases.length - 1] || null;
}

async function ingestSensorValue(sensorId, value, source = "api") {
  const sensorResult = await query(
    `SELECT sensor_id, sensor_type, threshold, dry_id
     FROM sensor_device
     WHERE sensor_id = $1`,
    [Number(sensorId)]
  );

  const sensor = sensorResult.rows[0];
  if (!sensor) {
    return { updated: false, reason: "sensor_not_found" };
  }

  const latestResult = await query(
    `SELECT last_value FROM sensor_latest WHERE sensor_id = $1`,
    [Number(sensorId)]
  );

  const hasLatest = latestResult.rows.length > 0;
  const lastValue = hasLatest ? Number(latestResult.rows[0].last_value) : null;
  const threshold = sensor.threshold == null ? 0 : Number(sensor.threshold);
  const changed = !hasLatest || Math.abs(Number(value) - lastValue) >= threshold;

  if (!changed) {
    return { updated: false, reason: "below_threshold" };
  }

  if (hasLatest) {
    await query(
      `UPDATE sensor_latest
       SET last_value = $1, updated_at = NOW()
       WHERE sensor_id = $2`,
      [Number(value), Number(sensorId)]
    );
  } else {
    await query(
      `INSERT INTO sensor_latest (sensor_id, last_value) VALUES ($1, $2)`,
      [Number(sensorId), Number(value)]
    );
  }

  await writeLog({
    logStyle: "parameter_change",
    message: `[${source}] sensor ${sensorId} -> ${value}`,
    sensorId: Number(sensorId),
    value: Number(value),
  });

  const runningBatchResult = await query(
    `SELECT batch_id, start_time, threshold_enabled, recipe_id
     FROM batch
     WHERE dry_id = $1 AND status = 'running'
     ORDER BY start_time DESC
     LIMIT 1`,
    [sensor.dry_id]
  );

  const batch = runningBatchResult.rows[0];
  if (!batch || !batch.threshold_enabled || !batch.start_time) {
    return { updated: true, batchEvaluated: false };
  }

  const phasesResult = await query(
    `SELECT phase_id, phase_order, duration_seconds
     FROM phase
     WHERE recipe_id = $1
     ORDER BY phase_order`,
    [batch.recipe_id]
  );

  const phases = phasesResult.rows;
  if (!phases.length) {
    return { updated: true, batchEvaluated: false };
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(batch.start_time).getTime()) / 1000)
  );

  const currentPhase = resolveCurrentPhase(phases, elapsedSeconds);
  if (!currentPhase) {
    return { updated: true, batchEvaluated: false };
  }

  const policiesResult = await query(
    `SELECT policy_id, policy_name
     FROM policy
     WHERE phase_id = $1 AND is_active = TRUE`,
    [currentPhase.phase_id]
  );

  for (const policy of policiesResult.rows) {
    const condResult = await query(
      `SELECT condition_id, sensor_id, value, cp_operator
       FROM policy_condition
       WHERE policy_id = $1`,
      [policy.policy_id]
    );

    if (!condResult.rows.length) {
      continue;
    }

    let allTrue = true;

    for (const condition of condResult.rows) {
      const currentResult = await query(
        `SELECT last_value
         FROM sensor_latest
         WHERE sensor_id = $1`,
        [condition.sensor_id]
      );

      const currentValue = currentResult.rows[0]?.last_value;
      if (currentValue == null) {
        allTrue = false;
        break;
      }

      if (!evalCondition(condition.cp_operator, Number(currentValue), Number(condition.value))) {
        allTrue = false;
        break;
      }
    }

    if (!allTrue) {
      continue;
    }

    await writeLog({
      logStyle: "sensor_trigger",
      message: `Policy ${policy.policy_name} triggered by sensor conditions`,
      batchId: batch.batch_id,
      sensorId: Number(sensorId),
      value: Number(value),
    });

    const actionsResult = await query(
      `SELECT pa.action_id, pa.action_type, cd.control_id, cd.control_type
       FROM policy_action pa
       JOIN control_device cd ON cd.control_id = pa.control_id
       WHERE pa.policy_id = $1`,
      [policy.policy_id]
    );

    for (const action of actionsResult.rows) {
      const nextStatus = action.action_type === "activate" ? "active" : "inactive";

      await query(
        `UPDATE control_device
         SET status = $1
         WHERE control_id = $2`,
        [nextStatus, action.control_id]
      );

      await writeLog({
        logStyle: "device_action",
        message: `Policy ${policy.policy_name}: ${action.control_type} #${action.control_id} -> ${nextStatus}`,
        batchId: batch.batch_id,
        controlId: action.control_id,
      });

      publishControlState(action.control_type, {
        control_id: action.control_id,
        status: nextStatus,
        source: "policy",
      });
    }
  }

  return { updated: true, batchEvaluated: true };
}

module.exports = {
  ingestSensorValue,
};
