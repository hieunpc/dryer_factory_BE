const express = require("express");
const { query, getClient } = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const HttpError = require("../utils/httpError");
const { ok, parseBool, ensureEnum } = require("../utils/routeHelpers");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// --- Fruits ---
router.get("/fruits", asyncHandler(async (_req, res) => {
  const result = await query(`SELECT fruit_id, fruit_name FROM fruit ORDER BY fruit_name`);
  return ok(res, result.rows);
}));

router.post("/fruits", requireAdmin, asyncHandler(async (req, res) => {
  if (!req.body.fruit_name) throw new HttpError(400, "VALIDATION_ERROR", "fruit_name is required");
  const result = await query(
    `INSERT INTO fruit (fruit_name) VALUES ($1) RETURNING fruit_id, fruit_name`,
    [req.body.fruit_name]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

// --- Recipes ---
router.get("/recipes", asyncHandler(async (req, res) => {
  const fruitId = req.query.fruit_id ? Number(req.query.fruit_id) : null;
  const isActive = parseBool(req.query.is_active);
  const result = await query(
    `SELECT recipe_id, recipe_name, recipe_type, fruit_id, is_active, created_at
     FROM recipe
     WHERE ($1::int IS NULL OR fruit_id = $1) AND ($2::boolean IS NULL OR is_active = $2)
     ORDER BY recipe_id DESC`,
    [fruitId, isActive]
  );
  return ok(res, result.rows);
}));

router.get("/recipes/:id", asyncHandler(async (req, res) => {
  const recipeId = Number(req.params.id);
  const recipeResult = await query(
    `SELECT recipe_id, recipe_name, recipe_type, fruit_id, is_active, created_at
     FROM recipe WHERE recipe_id = $1`,
    [recipeId]
  );
  const recipe = recipeResult.rows[0];
  if (!recipe) throw new HttpError(404, "NOT_FOUND", "Recipe not found");
  const phasesResult = await query(
    `SELECT phase_id, phase_order, duration_seconds, humidity, temperature, light
     FROM phase WHERE recipe_id = $1 ORDER BY phase_order`,
    [recipeId]
  );
  const phases = phasesResult.rows;
  const phaseIds = phases.map((phase) => phase.phase_id);
  let phaseActions = [];
  if (phaseIds.length) {
    const tableExists = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'phase_actions' LIMIT 1`
    );
    if (tableExists.rows.length) {
      phaseActions = (await query(
        `SELECT pa.action_id, pa.phase_id, pa.control_id, pa.action_type, pa.start_offset_seconds,
                pa.duration_seconds, cd.control_name, cd.control_type
         FROM phase_actions pa
         JOIN control_device cd ON pa.control_id = cd.control_id
         WHERE pa.phase_id = ANY($1::int[])
         ORDER BY pa.phase_id, pa.start_offset_seconds`,
        [phaseIds]
      )).rows;
    }
  }
  const actionsByPhase = phaseActions.reduce((acc, action) => {
    if (!acc[action.phase_id]) acc[action.phase_id] = [];
    acc[action.phase_id].push(action);
    return acc;
  }, {});
  return ok(res, {
    ...recipe,
    phases: phases.map((phase) => ({
      ...phase,
      actions: actionsByPhase[phase.phase_id] || [],
    })),
  });
}));

router.post("/recipes", requireAdmin, asyncHandler(async (req, res) => {
  const { recipe_name, recipe_type, fruit_id, phases } = req.body;
  if (!recipe_name || !recipe_type || !fruit_id || !Array.isArray(phases) || !phases.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "recipe_name, recipe_type, fruit_id and phases are required");
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const recipeInsert = await client.query(
      `INSERT INTO recipe (recipe_name, recipe_type, fruit_id) VALUES ($1, $2, $3)
       RETURNING recipe_id, recipe_name, recipe_type, fruit_id, is_active, created_at`,
      [recipe_name, recipe_type, Number(fruit_id)]
    );
    const recipe = recipeInsert.rows[0];
    for (const phase of phases) {
      const phaseLight = phase.light == null ? null : Number(phase.light);
      const phaseHumidity = phase.humidity == null ? null : Number(phase.humidity);
      const phaseTemperature = phase.temperature == null ? null : Number(phase.temperature);
      const phaseInsert = await client.query(
        `INSERT INTO phase (phase_order, recipe_id, duration_seconds, humidity, temperature, light)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING phase_id`,
        [Number(phase.phase_order), recipe.recipe_id, Number(phase.duration_seconds), phaseHumidity, phaseTemperature, phaseLight]
      );
      const phaseId = phaseInsert.rows[0].phase_id;
      
      // Create phase actions if provided
      if (Array.isArray(phase.actions) && phase.actions.length) {
        for (const action of phase.actions) {
          if (!action.control_id || !action.action_type) {
            throw new HttpError(400, "VALIDATION_ERROR", "action.control_id and action.action_type are required");
          }
          ensureEnum(action.action_type, ["activate", "deactivate"], "action_type");
          await client.query(
            `INSERT INTO phase_actions (phase_id, control_id, action_type, start_offset_seconds, duration_seconds)
             VALUES ($1, $2, $3, $4, $5)`,
            [phaseId, Number(action.control_id), action.action_type, 
             Number(action.start_offset_seconds || 0), 
             action.duration_seconds == null ? null : Number(action.duration_seconds)]
          );
        }
      }
    }
    await client.query("COMMIT");
    return res.status(201).json({ status: "success", data: recipe });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/recipes/:id", requireAdmin, asyncHandler(async (req, res) => {
  const recipeId = Number(req.params.id);
  const { recipe_name, recipe_type, is_active } = req.body;
  await query(
    `UPDATE recipe SET recipe_name = COALESCE($1, recipe_name), recipe_type = COALESCE($2, recipe_type),
       is_active = COALESCE($3, is_active) WHERE recipe_id = $4`,
    [recipe_name || null, recipe_type || null, parseBool(is_active), recipeId]
  );
  return ok(res, { message: "Recipe updated" });
}));

router.put("/recipes/:id/phases", requireAdmin, asyncHandler(async (req, res) => {
  const recipeId = Number(req.params.id);
  const { phases } = req.body;
  if (!Array.isArray(phases) || !phases.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "phases must be a non-empty array");
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    // Delete old phases (phase_actions will cascade delete)
    await client.query(`DELETE FROM phase WHERE recipe_id = $1`, [recipeId]);
    for (const phase of phases) {
      const phaseLight = phase.light == null ? null : Number(phase.light);
      const phaseHumidity = phase.humidity == null ? null : Number(phase.humidity);
      const phaseTemperature = phase.temperature == null ? null : Number(phase.temperature);
      const phaseInsert = await client.query(
        `INSERT INTO phase (phase_order, recipe_id, duration_seconds, humidity, temperature, light)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING phase_id`,
        [Number(phase.phase_order), recipeId, Number(phase.duration_seconds), phaseHumidity, phaseTemperature, phaseLight]
      );
      const phaseId = phaseInsert.rows[0].phase_id;
      
      // Create phase actions if provided
      if (Array.isArray(phase.actions) && phase.actions.length) {
        for (const action of phase.actions) {
          if (!action.control_id || !action.action_type) {
            throw new HttpError(400, "VALIDATION_ERROR", "action.control_id and action.action_type are required");
          }
          ensureEnum(action.action_type, ["activate", "deactivate"], "action_type");
          await client.query(
            `INSERT INTO phase_actions (phase_id, control_id, action_type, start_offset_seconds, duration_seconds)
             VALUES ($1, $2, $3, $4, $5)`,
            [phaseId, Number(action.control_id), action.action_type, 
             Number(action.start_offset_seconds || 0), 
             action.duration_seconds == null ? null : Number(action.duration_seconds)]
          );
        }
      }
    }
    await client.query("COMMIT");
    return ok(res, { message: "Recipe phases replaced" });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));



// --- Policies ---
router.get("/policies", asyncHandler(async (req, res) => {
  const phaseId = req.query.phase_id ? Number(req.query.phase_id) : null;
  const recipeId = req.query.recipe_id ? Number(req.query.recipe_id) : null;
  const isActive = parseBool(req.query.is_active);
  const result = await query(
    `SELECT p.policy_id, p.policy_type, p.policy_name, p.phase_id, p.is_active, p.created_at
     FROM policy p JOIN phase ph ON ph.phase_id = p.phase_id
     WHERE ($1::int IS NULL OR p.phase_id = $1)
       AND ($2::int IS NULL OR ph.recipe_id = $2)
       AND ($3::boolean IS NULL OR p.is_active = $3)
     ORDER BY p.policy_id DESC`,
    [phaseId, recipeId, isActive]
  );
  return ok(res, result.rows);
}));

router.post("/policies", requireAdmin, asyncHandler(async (req, res) => {
  const { policy_name, policy_type, phase_id, is_active = true } = req.body;
  if (!policy_name || !policy_type || !phase_id) {
    throw new HttpError(400, "VALIDATION_ERROR", "policy_name, policy_type and phase_id are required");
  }

  const phaseCheck = await query(
    `SELECT phase_id FROM phase WHERE phase_id = $1`,
    [Number(phase_id)]
  );
  if (!phaseCheck.rows.length) {
    throw new HttpError(404, "NOT_FOUND", "Phase not found");
  }
  const result = await query(
    `INSERT INTO policy (policy_type, policy_name, phase_id, is_active) VALUES ($1, $2, $3, $4)
     RETURNING policy_id, policy_type, policy_name, phase_id, is_active, created_at`,
    [policy_type, policy_name, Number(phase_id), Boolean(is_active)]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.post("/policies/:id/conditions", requireAdmin, asyncHandler(async (req, res) => {
  const policyId = Number(req.params.id);
  const { sensor_id, value, cp_operator } = req.body;
  ensureEnum(cp_operator, [">", "<", ">=", "<=", "="], "cp_operator");
  const result = await query(
    `INSERT INTO policy_condition (policy_id, sensor_id, value, cp_operator) VALUES ($1, $2, $3, $4)
     RETURNING condition_id, policy_id, sensor_id, value, cp_operator`,
    [policyId, Number(sensor_id), Number(value), cp_operator]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.patch("/policies/:id/conditions/:conditionId", requireAdmin, asyncHandler(async (req, res) => {
  const policyId = Number(req.params.id);
  const conditionId = Number(req.params.conditionId);
  const { sensor_id, value, cp_operator } = req.body;

  if (cp_operator != null) {
    ensureEnum(cp_operator, [">", "<", ">=", "<=", "="], "cp_operator");
  }

  // Ensure the condition exists and belongs to the expected policy
  const existingCondition = await query(
    `SELECT condition_id FROM policy_condition WHERE policy_id = $1 AND condition_id = $2`,
    [policyId, conditionId]
  );
  if (!existingCondition.rows.length) {
    throw new HttpError(404, "NOT_FOUND", "Policy condition not found");
  }

  await query(
    `UPDATE policy_condition
     SET sensor_id = COALESCE($1, sensor_id),
         value = COALESCE($2, value),
         cp_operator = COALESCE($3, cp_operator)
     WHERE policy_id = $4 AND condition_id = $5`,
    [sensor_id == null ? null : Number(sensor_id), value == null ? null : Number(value), cp_operator || null, policyId, conditionId]
  );

  return ok(res, { message: "Policy condition updated" });
}));

router.post("/policies/:id/actions", requireAdmin, asyncHandler(async (req, res) => {
  const policyId = Number(req.params.id);
  const { control_id, action_type } = req.body;
  ensureEnum(action_type, ["activate", "deactivate"], "action_type");
  const result = await query(
    `INSERT INTO policy_action (policy_id, control_id, action_type) VALUES ($1, $2, $3)
     RETURNING action_id, policy_id, control_id, action_type`,
    [policyId, Number(control_id), action_type]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.delete("/policies/:id/conditions/:conditionId", requireAdmin, asyncHandler(async (req, res) => {
  await query(`DELETE FROM policy_condition WHERE policy_id = $1 AND condition_id = $2`,
    [Number(req.params.id), Number(req.params.conditionId)]);
  return ok(res, { message: "Condition deleted" });
}));

router.delete("/policies/:id/actions/:actionId", requireAdmin, asyncHandler(async (req, res) => {
  await query(`DELETE FROM policy_action WHERE policy_id = $1 AND action_id = $2`,
    [Number(req.params.id), Number(req.params.actionId)]);
  return ok(res, { message: "Action deleted" });
}));

router.get("/phases/:id/actions", asyncHandler(async (req, res) => {
  const phaseId = Number(req.params.id);
  const phaseCheck = await query(`SELECT phase_id FROM phase WHERE phase_id = $1`, [phaseId]);
  if (!phaseCheck.rows.length) throw new HttpError(404, "NOT_FOUND", "Phase not found");
  const result = await query(
    `SELECT pa.action_id, pa.phase_id, pa.control_id, pa.action_type, pa.start_offset_seconds,
            pa.duration_seconds, cd.control_name, cd.control_type
     FROM phase_actions pa
     JOIN control_device cd ON pa.control_id = cd.control_id
     WHERE pa.phase_id = $1
     ORDER BY pa.start_offset_seconds`,
    [phaseId]
  );
  return ok(res, result.rows);

}));

router.post("/phases/:id/actions", requireAdmin, asyncHandler(async (req, res) => {
  const phaseId = Number(req.params.id);
  const { control_id, action_type, start_offset_seconds = 0, duration_seconds = null } = req.body;
  if (!control_id || !action_type) {
    throw new HttpError(400, "VALIDATION_ERROR", "control_id and action_type are required");
  }
  ensureEnum(action_type, ["activate", "deactivate"], "action_type");

  const phaseCheck = await query(`SELECT phase_id FROM phase WHERE phase_id = $1`, [phaseId]);
  if (!phaseCheck.rows.length) throw new HttpError(404, "NOT_FOUND", "Phase not found");

  const controlCheck = await query(`SELECT control_id FROM control_device WHERE control_id = $1`, [Number(control_id)]);
  if (!controlCheck.rows.length) throw new HttpError(404, "NOT_FOUND", "Control device not found");

  const result = await query(
    `INSERT INTO phase_actions (phase_id, control_id, action_type, start_offset_seconds, duration_seconds)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING action_id, phase_id, control_id, action_type, start_offset_seconds, duration_seconds`,
    [phaseId, Number(control_id), action_type, Number(start_offset_seconds), duration_seconds == null ? null : Number(duration_seconds)]
  );
  return res.status(201).json({ status: "success", data: result.rows[0] });
}));

router.delete("/phases/:id/actions/:actionId", requireAdmin, asyncHandler(async (req, res) => {
  const phaseId = Number(req.params.id);
  await query(
    `DELETE FROM phase_actions WHERE phase_id = $1 AND action_id = $2`,
    [phaseId, Number(req.params.actionId)]
  );
  return ok(res, { message: "Phase action deleted" });
}));

module.exports = router;
