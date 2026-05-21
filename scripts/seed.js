/* eslint-disable no-console */
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 55432,
  database: process.env.DB_NAME || "dryerdb",
  user: process.env.DB_USER || "dryer",
  password: process.env.DB_PASSWORD || "dryer123",
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Admin user  (password: 123456)
    const hash = await bcrypt.hash("123456", 10);
    await client.query(
      `INSERT INTO app_user (app_user_name, email, password_hash, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      ["System Admin", "admin@gmail.com", hash, true]
    );

    // Operator user (password: 123456)
    const hash2 = await bcrypt.hash("123456", 10);
    await client.query(
      `INSERT INTO app_user (app_user_name, email, password_hash, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      ["Operator A", "operator@gmail.com", hash2, false]
    );

    // Areas
    const areaA = await client.query(
      `INSERT INTO Area (area_name) VALUES ('Khu vuc A') RETURNING area_id`
    );
    const areaB = await client.query(
      `INSERT INTO Area (area_name) VALUES ('Khu vuc B') RETURNING area_id`
    );
    const areaIdA = areaA.rows[0].area_id;
    const areaIdB = areaB.rows[0].area_id;

    // Dryers
    const d1 = await client.query(
      `INSERT INTO Dryer (dry_name, status, area_id) VALUES ('Dryer 01', 'Idle', $1) RETURNING dry_id`,
      [areaIdA]
    );
    const d2 = await client.query(
      `INSERT INTO Dryer (dry_name, status, area_id) VALUES ('Dryer 02', 'Idle', $1) RETURNING dry_id`,
      [areaIdA]
    );
    const d3 = await client.query(
      `INSERT INTO Dryer (dry_name, status, area_id) VALUES ('Dryer 03', 'Idle', $1) RETURNING dry_id`,
      [areaIdB]
    );
    const d4 = await client.query(
      `INSERT INTO Dryer (dry_name, status, area_id) VALUES ('Dryer 04', 'Idle', $1) RETURNING dry_id`,
      [areaIdB]
    );
    const dryIds = [d1.rows[0].dry_id, d2.rows[0].dry_id, d3.rows[0].dry_id, d4.rows[0].dry_id];

    // Sensors & Controls for each dryer
    for (const dryId of dryIds) {
      await client.query(
        `INSERT INTO sensor_device (sensor_type, threshold, dry_id) VALUES ('temperature', 1.5, $1)`,
        [dryId]
      );
      await client.query(
        `INSERT INTO sensor_device (sensor_type, threshold, dry_id) VALUES ('humidity', 2.0, $1)`,
        [dryId]
      );
      await client.query(
        `INSERT INTO sensor_device (sensor_type, threshold, dry_id) VALUES ('light', 10.0, $1)`,
        [dryId]
      );
      await client.query(
        `INSERT INTO control_device (control_name, control_type, status, dry_id)
         VALUES ('Fan 1', 'fan', 'inactive', $1)`,
        [dryId]
      );
      await client.query(
        `INSERT INTO control_device (control_name, control_type, status, dry_id)
         VALUES ('Lamp 1', 'lamp', 'inactive', $1)`,
        [dryId]
      );
    }

    // Set initial sensor_latest values for all created sensors
    const sensors = await client.query(
      `SELECT sensor_id FROM sensor_device WHERE dry_id = ANY($1::int[])`,
      [dryIds]
    );
    for (const s of sensors.rows) {
      await client.query(
        `INSERT INTO sensor_latest (sensor_id, last_value) VALUES ($1, $2)
         ON CONFLICT (sensor_id) DO NOTHING`,
        [s.sensor_id, 25.0 + Math.random() * 30]
      );
    }

    // Fruits
    const mango = await client.query(
      `INSERT INTO fruit (fruit_name) VALUES ('Xoai') RETURNING fruit_id`
    );
    const jackfruit = await client.query(
      `INSERT INTO fruit (fruit_name) VALUES ('Mit') RETURNING fruit_id`
    );
    const mangoId = mango.rows[0].fruit_id;
    const jackfruitId = jackfruit.rows[0].fruit_id;

    // Recipe for Mango
    const r1 = await client.query(
      `INSERT INTO recipe (recipe_name, recipe_type, fruit_id)
       VALUES ('Say Xoai Tieu Chuan', 'standard', $1) RETURNING recipe_id`,
      [mangoId]
    );
    const recipeId1 = r1.rows[0].recipe_id;

    const p1 = await client.query(
      `INSERT INTO phase (phase_order, recipe_id, duration_seconds, humidity, temperature)
       VALUES (1, $1, 3600, 72, 52) RETURNING phase_id`,
      [recipeId1]
    );
    await client.query(
      `INSERT INTO phase (phase_order, recipe_id, duration_seconds, humidity, temperature)
       VALUES (2, $1, 5400, 65, 56)`,
      [recipeId1]
    );

    // Recipe for Jackfruit
    const r2 = await client.query(
      `INSERT INTO recipe (recipe_name, recipe_type, fruit_id)
       VALUES ('Say Mit Dac Biet', 'premium', $1) RETURNING recipe_id`,
      [jackfruitId]
    );
    const recipeId2 = r2.rows[0].recipe_id;

    await client.query(
      `INSERT INTO phase (phase_order, recipe_id, duration_seconds, humidity, temperature)
       VALUES (1, $1, 7200, 70, 50)`,
      [recipeId2]
    );

    // New recipe for scheduled mode without temp/humidity (device actions only)
    const r3 = await client.query(
      `INSERT INTO recipe (recipe_name, recipe_type, fruit_id)
       VALUES ('Say Theo Lich Thu Cong', 'scheduled', $1) RETURNING recipe_id`,
      [mangoId]
    );
    const recipeId3 = r3.rows[0].recipe_id;

    // Phase 1: 1 hour, activate fan
    const p3_1 = await client.query(
      `INSERT INTO phase (phase_order, recipe_id, duration_seconds)
       VALUES (1, $1, 3600) RETURNING phase_id`,
      [recipeId3]
    );
    const phaseId3_1 = p3_1.rows[0].phase_id;

    // Phase 2: 30 minutes, deactivate fan
    const p3_2 = await client.query(
      `INSERT INTO phase (phase_order, recipe_id, duration_seconds)
       VALUES (2, $1, 1800) RETURNING phase_id`,
      [recipeId3]
    );
    const phaseId3_2 = p3_2.rows[0].phase_id;

    // Phase 3: 10 minutes, activate fan again (fan handles both temperature and humidity control)
    const p3_3 = await client.query(
      `INSERT INTO phase (phase_order, recipe_id, duration_seconds)
       VALUES (3, $1, 600) RETURNING phase_id`,
      [recipeId3]
    );
    const phaseId3_3 = p3_3.rows[0].phase_id;

    // Add dehumidifier control for dryer 1 - REMOVED as per user feedback
    // Fan handles both temperature and humidity

    // Phase actions
    // Phase 1: activate fan
    const fanId = (await client.query(
      `SELECT control_id FROM control_device WHERE dry_id = $1 AND control_type = 'fan' LIMIT 1`,
      [dryIds[0]]
    )).rows[0].control_id;

    await client.query(
      `INSERT INTO phase_actions (phase_id, control_id, action_type)
       VALUES ($1, $2, 'activate')`,
      [phaseId3_1, fanId]
    );

    // Phase 2: deactivate fan
    await client.query(
      `INSERT INTO phase_actions (phase_id, control_id, action_type)
       VALUES ($1, $2, 'deactivate')`,
      [phaseId3_2, fanId]
    );

    // Phase 3: activate fan again
    await client.query(
      `INSERT INTO phase_actions (phase_id, control_id, action_type)
       VALUES ($1, $2, 'activate')`,
      [phaseId3_3, fanId]
    );

    // Add light sensor for dryer 1 - REMOVED as already added in loop

    // Policy on mango recipe phase 1
    const phaseId = p1.rows[0].phase_id;
    const pol = await client.query(
      `INSERT INTO policy (policy_type, policy_name, phase_id)
       VALUES ('threshold', 'Humidity Guard P1', $1) RETURNING policy_id`,
      [phaseId]
    );
    const policyId = pol.rows[0].policy_id;

    // Get first humidity sensor
    const humSensor = await client.query(
      `SELECT sensor_id FROM sensor_device WHERE dry_id = $1 AND sensor_type = 'humidity' LIMIT 1`,
      [dryIds[0]]
    );
    if (humSensor.rows.length) {
      await client.query(
        `INSERT INTO policy_condition (policy_id, sensor_id, value, cp_operator)
         VALUES ($1, $2, 75, '>=')`,
        [policyId, humSensor.rows[0].sensor_id]
      );
    }

    // Get first fan control
    const fanCtrl = await client.query(
      `SELECT control_id FROM control_device WHERE dry_id = $1 AND control_type = 'fan' LIMIT 1`,
      [dryIds[0]]
    );
    if (fanCtrl.rows.length) {
      await client.query(
        `INSERT INTO policy_action (policy_id, control_id, action_type)
         VALUES ($1, $2, 'activate')`,
        [policyId, fanCtrl.rows[0].control_id]
      );
    }

    // Scope: grant operator access to area A
    await client.query(
      `INSERT INTO user_scope (app_user_id, area_id)
       VALUES (2, $1)`,
      [areaIdA]
    );

    await client.query("COMMIT");
    console.log("Seed data inserted successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
