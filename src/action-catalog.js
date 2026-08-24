const crypto = require('crypto');

function positiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function calculateEstimate(action, request = {}) {
  const quantity = positiveInteger(request.quantity, 1);
  const step = positiveInteger(action.quantity_step, 1);
  const units = Math.ceil(quantity / step);
  const pricing = parseJson(action.pricing_config_json);
  let perUnit = Number(action.base_credits || 0);

  if (action.pricing_type === 'tiered_credits') {
    const level = String(request.level || 'standard');
    perUnit = Number(pricing[level] ?? pricing.standard ?? action.base_credits ?? 0);
  }

  let credits = action.pricing_type === 'included_with_purchase' ? 0 : units * perUnit;
  credits = Math.max(Number(action.minimum_credits || 0), credits);
  if (action.maximum_credits != null) credits = Math.min(Number(action.maximum_credits), credits);

  return {
    action_code: action.action_code,
    quantity,
    billing_unit: action.billing_unit,
    quantity_step: step,
    billable_units: units,
    credits,
    pricing_type: action.pricing_type,
    level: request.level || null,
    estimate_key: crypto.randomUUID()
  };
}

async function listCatalog(db, { activeOnly = true } = {}) {
  const where = activeOnly ? 'WHERE a.active=1 AND m.lifecycle_status<>\'retired\'' : '';
  const [rows] = await db.query(
    `SELECT a.*,m.name module_name,m.module_type,m.version module_version,m.lifecycle_status module_status
     FROM action_catalog a JOIN app_modules m ON m.module_key=a.module_key
     ${where} ORDER BY a.category,a.name`
  );
  return rows.map(row => ({
    ...row,
    pricing_config: parseJson(row.pricing_config_json),
    output_contract: parseJson(row.output_contract_json)
  }));
}

async function getAction(db, actionCode) {
  const [rows] = await db.execute(
    `SELECT a.*,m.lifecycle_status module_status
     FROM action_catalog a JOIN app_modules m ON m.module_key=a.module_key
     WHERE a.action_code=? AND a.active=1 LIMIT 1`,
    [actionCode]
  );
  return rows[0] || null;
}

async function getCreditBalance(db, userId) {
  const [[row]] = await db.execute(
    `SELECT COALESCE(SUM(amount),0) balance
     FROM credit_ledger
     WHERE user_id=? AND (expires_at IS NULL OR expires_at>NOW())`,
    [userId]
  );
  const [[reserved]] = await db.execute(
    `SELECT COALESCE(SUM(reserved_credits),0) reserved
     FROM credit_reservations
     WHERE user_id=? AND state='reserved' AND expires_at>NOW()`,
    [userId]
  );
  return {
    ledger: Number(row.balance),
    reserved: Number(reserved.reserved),
    available: Number(row.balance) - Number(reserved.reserved)
  };
}

async function createReservation(db, { userId, action, estimate, jobKey = null, ttlMinutes = 30 }) {
  const balance = await getCreditBalance(db, userId);
  if (balance.available < estimate.credits) {
    const error = new Error('insufficient_credits');
    error.code = 'insufficient_credits';
    error.balance = balance;
    throw error;
  }
  const reservationKey = crypto.randomUUID();
  await db.execute(
    `INSERT INTO credit_reservations
     (reservation_key,user_id,action_code,job_key,reserved_credits,state,estimate_json,expires_at)
     VALUES(?,?,?,?,?,'reserved',?,DATE_ADD(NOW(),INTERVAL ? MINUTE))`,
    [reservationKey, userId, action.action_code, jobKey, estimate.credits, JSON.stringify(estimate), ttlMinutes]
  );
  return { reservation_key: reservationKey, state: 'reserved', credits: estimate.credits, balance };
}

module.exports = {
  calculateEstimate,
  createReservation,
  getAction,
  getCreditBalance,
  listCatalog,
  parseJson
};

