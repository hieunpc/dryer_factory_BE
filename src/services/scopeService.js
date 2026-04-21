const { query } = require("../config/db");

function uniqueIds(rows, key) {
  return [...new Set(rows.map((r) => Number(r[key])).filter((v) => Number.isInteger(v)))];
}

async function getAccessibleDryerIds(user) {
  if (user.isAdmin) {
    return null;
  }

  const result = await query(
    `SELECT d.dry_id
     FROM Dryer d
     WHERE EXISTS (
       SELECT 1
       FROM user_scope us
       JOIN Area a ON a.area_id = d.area_id
       WHERE us.app_user_id = $1
         AND (
           us.dry_id = d.dry_id
           OR us.area_id = d.area_id
           OR us.fac_id = a.fac_id
         )
     )`,
    [user.id]
  );

  return uniqueIds(result.rows, "dry_id");
}

async function ensureDryerAccess(user, dryerId) {
  if (user.isAdmin) {
    return true;
  }

  const ids = await getAccessibleDryerIds(user);
  return ids.includes(Number(dryerId));
}

function inClauseFromIds(ids) {
  if (!ids || ids.length === 0) {
    return "(NULL)";
  }
  return `(${ids.join(",")})`;
}

module.exports = {
  getAccessibleDryerIds,
  ensureDryerAccess,
  inClauseFromIds,
};
