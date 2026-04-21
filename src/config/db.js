const { Pool, types } = require("pg");
const env = require("./env");

// Parse PostgreSQL bigint (COUNT, SUM) as JavaScript number instead of string
types.setTypeParser(20, (val) => parseInt(val, 10));

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  max: 10,
  idleTimeoutMillis: 30000,
});

async function getPool() {
  // Verify connection on startup
  const client = await pool.connect();
  client.release();
  return pool;
}

async function query(text, params = []) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

module.exports = {
  pool,
  getPool,
  query,
  getClient,
};
