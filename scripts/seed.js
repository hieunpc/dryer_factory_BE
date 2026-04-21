/* eslint-disable no-console */
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 55432,
  database: process.env.DB_NAME || "factorydb",
  user: process.env.DB_USER || "factory",
  password: process.env.DB_PASSWORD || "factory123",
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

    // Factory
    const fac = await client.query(
      `INSERT INTO Factory (fac_name) VALUES ('Nha may say Binh Duong')
       RETURNING fac_id`
    );
    const facId = fac.rows[0].fac_id;

    // Areas
    const areaA = await client.query(
      `INSERT INTO Area (area_name, fac_id) VALUES ('Khu vuc A', $1) RETURNING area_id`,
      [facId]
    );
    const areaB = await client.query(
      `INSERT INTO Area (area_name, fac_id) VALUES ('Khu vuc B', $1) RETURNING area_id`,
      [facId]
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
    const dryIds = [d1.rows[0].dry_id, d2.rows[0].dry_id, d3.rows[0].dry_id];

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

    // Set initial sensor_latest values for dryer 1 sensors
    const sensors = await client.query(
      `SELECT sensor_id FROM sensor_device WHERE dry_id = $1`,
      [dryIds[0]]
    );
    for (const s of sensors.rows) {
      await client.query(
        `INSERT INTO sensor_latest (sensor_id, last_value) VALUES ($1, $2)`,
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

    // Scope: grant operator access to factory
    await client.query(
      `INSERT INTO user_scope (app_user_id, fac_id)
       VALUES (2, $1)`,
      [facId]
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
