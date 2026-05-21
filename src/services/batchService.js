const { query } = require("../config/db");
const { writeLog } = require("./logService");
const { publishControlState } = require("../config/mqtt");

const SCHEDULED_BATCH_POLL_SECONDS = 10;

function getBatchElapsedSeconds(batch) {
  const baseElapsed = Number(batch.elapsed_seconds || 0);
  if (batch.status === "running" && batch.start_time) {
    const now = Date.now();
    const startMs = new Date(batch.start_time).getTime();
    return baseElapsed + Math.max(0, Math.floor((now - startMs) / 1000));
  }
  return baseElapsed;
}

function resolveCurrentPhase(phases, elapsedSeconds) {
  let accumulated = 0;
  for (const phase of phases) {
    accumulated += Number(phase.duration_seconds);
    if (elapsedSeconds <= accumulated) {
      return phase;
    }
  }
  return phases[phases.length - 1] || null;
}

function calculatePhaseInfo(phases, elapsedSeconds) {
  const totalDuration = phases.reduce((sum, phase) => sum + Number(phase.duration_seconds), 0);
  const currentPhase = resolveCurrentPhase(phases, elapsedSeconds);
  if (!currentPhase) {
    return {
      elapsed_seconds: elapsedSeconds,
      total_duration_seconds: totalDuration,
      current_phase: null,
      current_phase_order: null,
      current_phase_remaining_seconds: 0,
      total_remaining_seconds: Math.max(0, totalDuration - elapsedSeconds),
    };
  }

  let phaseEnd = 0;
  for (const phase of phases) {
    phaseEnd += Number(phase.duration_seconds);
    if (phase.phase_id === currentPhase.phase_id) {
      break;
    }
  }

  const phaseStart = phaseEnd - Number(currentPhase.duration_seconds);
  const phaseElapsed = Math.max(0, elapsedSeconds - phaseStart);
  const remainingInPhase = Math.max(0, Number(currentPhase.duration_seconds) - phaseElapsed);

  return {
    elapsed_seconds: elapsedSeconds,
    total_duration_seconds: totalDuration,
    current_phase: {
      phase_id: currentPhase.phase_id,
      phase_order: currentPhase.phase_order,
      duration_seconds: Number(currentPhase.duration_seconds),
      humidity: currentPhase.humidity != null ? Number(currentPhase.humidity) : null,
      temperature: currentPhase.temperature != null ? Number(currentPhase.temperature) : null,
      light: currentPhase.light != null ? Number(currentPhase.light) : null,
    },
    current_phase_order: currentPhase.phase_order,
    current_phase_remaining_seconds: remainingInPhase,
    total_remaining_seconds: Math.max(0, totalDuration - elapsedSeconds),
  };
}

async function executePhaseActions(batchId, phaseId, dryId) {
  const actionsResult = await query(
    `SELECT pa.action_id, pa.control_id, pa.action_type, pa.start_offset_seconds, pa.duration_seconds,
            cd.control_name, cd.control_type
     FROM phase_actions pa
     JOIN control_device cd ON pa.control_id = cd.control_id
     WHERE pa.phase_id = $1
     ORDER BY pa.start_offset_seconds`,
    [Number(phaseId)]
  );

  for (const action of actionsResult.rows) {
    // For simplicity, execute actions immediately when entering phase
    // In a real system, you might schedule them with offsets
    await query(
      `UPDATE control_device SET status = $1 WHERE control_id = $2 AND dry_id = $3`,
      [action.action_type === 'activate' ? 'active' : 'inactive', Number(action.control_id), Number(dryId)]
    );

    // Publish MQTT
    await publishControlState(dryId, Number(action.control_id), action.action_type === 'activate' ? 'active' : 'inactive');

    // Log
    await writeLog({
      logStyle: "device_action",
      message: `Phase action: ${action.action_type} ${action.control_type} ${action.control_name || action.control_id} in batch ${batchId}`,
      batchId: Number(batchId),
      controlId: Number(action.control_id),
    });
  }
}

async function getBatchPhaseInfo(batchId) {
  const batchResult = await query(
    `SELECT batch_id, start_time, status, operation_mode, recipe_id, elapsed_seconds
     FROM batch WHERE batch_id = $1`,
    [Number(batchId)]
  );
  const batch = batchResult.rows[0];
  if (!batch) {
    return null;
  }

  const phasesResult = await query(
    `SELECT phase_id, phase_order, duration_seconds, humidity, temperature, light
     FROM phase WHERE recipe_id = $1 ORDER BY phase_order`,
    [Number(batch.recipe_id)]
  );
  const phases = phasesResult.rows;
  const elapsedSeconds = getBatchElapsedSeconds(batch);

  if (batch.status !== "running" && batch.status !== "paused") {
    return {
      batch_id: batch.batch_id,
      status: batch.status,
      operation_mode: batch.operation_mode,
      current_phase: null,
      elapsed_seconds: 0,
      total_duration_seconds: 0,
      current_phase_remaining_seconds: 0,
      total_remaining_seconds: 0,
    };
  }

  return {
    batch_id: batch.batch_id,
    status: batch.status,
    operation_mode: batch.operation_mode,
    ...calculatePhaseInfo(phases, elapsedSeconds),
  };
}

async function processScheduledBatches() {
  
  const pendingBatches = await query(
    `SELECT batch_id, dry_id, recipe_id, scheduled_start_time
     FROM batch
     WHERE status = 'pending' 
       AND operation_mode = 'scheduled'
       AND scheduled_start_time IS NOT NULL
       AND scheduled_start_time <= NOW()`
  );

  for (const batch of pendingBatches.rows) {
    try {
      const dryerCheck = await query(
        `SELECT status FROM Dryer WHERE dry_id = $1`,
        [batch.dry_id]
      );
      
      if (!dryerCheck.rows[0] || dryerCheck.rows[0].status !== "Idle") {
        continue;
      }

      await query(
        `UPDATE batch SET status = 'running', start_time = NOW(), 
         elapsed_seconds = 0 WHERE batch_id = $1`,
        [batch.batch_id]
      );
      
      await query(
        `UPDATE Dryer SET status = 'Running' WHERE dry_id = $1`,
        [batch.dry_id]
      );

      const firstPhaseResult = await query(
        `SELECT phase_id FROM phase WHERE recipe_id = $1 
         ORDER BY phase_order LIMIT 1`,
        [batch.recipe_id]
      );
          // Auto-start scheduled batches that have a scheduled_start_time reached
          const pendingToStart = await query(
            `SELECT batch_id, dry_id, recipe_id, scheduled_start_time
             FROM batch
             WHERE status = 'pending' AND operation_mode = 'scheduled' AND scheduled_start_time IS NOT NULL AND scheduled_start_time <= NOW()`
          );

          for (const pb of pendingToStart.rows) {
            // skip if dryer already has a running batch
            const runningCount = await query(
              `SELECT COUNT(*)::int AS total FROM batch WHERE dry_id = $1 AND status = 'running'`,
              [Number(pb.dry_id)]
            );
            if (runningCount.rows[0].total > 0) {
              await writeLog({ logStyle: "batch_running", message: `Scheduled batch ${pb.batch_id} skipped (dryer busy)`, batchId: Number(pb.batch_id) });
              continue;
            }

            const dryerStatusResult = await query(`SELECT status FROM Dryer WHERE dry_id = $1`, [Number(pb.dry_id)]);
            const dryerStatus = dryerStatusResult.rows[0];
            if (!dryerStatus || dryerStatus.status !== 'Idle') {
              await writeLog({ logStyle: "batch_running", message: `Scheduled batch ${pb.batch_id} skipped (dryer not Idle)`, batchId: Number(pb.batch_id) });
              continue;
            }

            // start the batch
            await query(`UPDATE batch SET status = 'running', start_time = NOW(), elapsed_seconds = 0 WHERE batch_id = $1`, [Number(pb.batch_id)]);
            await query(`UPDATE Dryer SET status = 'Running' WHERE dry_id = $1`, [Number(pb.dry_id)]);
            await writeLog({ logStyle: "batch_start", message: `Scheduled batch ${pb.batch_id} auto-started`, batchId: Number(pb.batch_id) });

            const firstPhaseResult = await query(
              `SELECT phase_id FROM phase WHERE recipe_id = $1 ORDER BY phase_order LIMIT 1`,
              [Number(pb.recipe_id)]
            );
            if (firstPhaseResult.rows.length) {
              await executePhaseActions(pb.batch_id, firstPhaseResult.rows[0].phase_id, pb.dry_id);
            }
          }
      
      if (firstPhaseResult.rows.length) {
        await executePhaseActions(
          batch.batch_id,
          firstPhaseResult.rows[0].phase_id,
          batch.dry_id
        );
      }

      await writeLog({
        logStyle: "batch_start",
        message: `Batch ${batch.batch_id} auto-started (scheduled)`,
        batchId: batch.batch_id
      });
    } catch (error) {
      console.error(`Error auto-starting batch ${batch.batch_id}:`, error);
    }
  }

  const runningBatches = await query(
    `SELECT batch_id, dry_id, recipe_id, start_time
     FROM batch
     WHERE status = 'running' AND operation_mode = 'scheduled'`
  );

  const now = Date.now();

  for (const batch of runningBatches.rows) {
    if (!batch.start_time) {
      continue;
    }

    const phasesResult = await query(
      `SELECT phase_id, phase_order, duration_seconds
       FROM phase WHERE recipe_id = $1 ORDER BY phase_order`,
      [Number(batch.recipe_id)]
    );
    const phases = phasesResult.rows;
    if (!phases.length) {
      await query(
        `UPDATE batch SET status = 'failed', end_time = NOW() WHERE batch_id = $1`,
        [Number(batch.batch_id)]
      );
      await query(
        `UPDATE Dryer SET status = 'Idle' WHERE dry_id = $1`,
        [Number(batch.dry_id)]
      );
      await writeLog({
        logStyle: "batch_end",
        message: `Scheduled batch ${batch.batch_id} failed due to missing recipe phases`,
        batchId: Number(batch.batch_id),
      });
      continue;
    }

    const elapsedSeconds = getBatchElapsedSeconds(batch);
    const totalDuration = phases.reduce((sum, phase) => sum + Number(phase.duration_seconds), 0);

    if (elapsedSeconds >= totalDuration) {
      await query(
        `UPDATE batch SET status = 'completed', end_time = NOW() WHERE batch_id = $1`,
        [Number(batch.batch_id)]
      );
      await query(
        `UPDATE Dryer SET status = 'Idle' WHERE dry_id = $1`,
        [Number(batch.dry_id)]
      );
      await writeLog({
        logStyle: "batch_end",
        message: `Scheduled batch ${batch.batch_id} completed`,
        batchId: Number(batch.batch_id),
      });
      continue;
    }

    // Check for phase transitions
    let accumulatedTime = 0;
    let currentPhase = null;
    let previousPhase = null;

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const phaseStartTime = accumulatedTime;
      const phaseEndTime = accumulatedTime + Number(phase.duration_seconds);

      if (elapsedSeconds >= phaseStartTime && elapsedSeconds < phaseEndTime) {
        currentPhase = phase;
        previousPhase = i > 0 ? phases[i - 1] : null;
        break;
      }

      accumulatedTime += Number(phase.duration_seconds);
    }

    if (currentPhase) {
      // Check if we just entered this phase (within the last poll interval)
      const phaseStartTime = phases
        .slice(0, currentPhase.phase_order - 1)
        .reduce((sum, p) => sum + Number(p.duration_seconds), 0);

      const timeIntoPhase = elapsedSeconds - phaseStartTime;
      const pollInterval = SCHEDULED_BATCH_POLL_SECONDS;

      if (timeIntoPhase <= pollInterval && timeIntoPhase > 0) {
        await writeLog({
          logStyle: "batch_running",
          message: `Batch ${batch.batch_id} entered phase ${currentPhase.phase_order} (${currentPhase.duration_seconds}s)`,
          batchId: Number(batch.batch_id),
        });

        // Execute phase actions for scheduled mode
        await executePhaseActions(batch.batch_id, currentPhase.phase_id, batch.dry_id);
      }
    }
  }
}


module.exports = {
  getBatchPhaseInfo,
  processScheduledBatches,
  executePhaseActions,
};
