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

function activeWindow(row) {
  const now = Date.now();
  return (!row.effective_from || new Date(row.effective_from).getTime() <= now) &&
    (!row.effective_until || new Date(row.effective_until).getTime() > now);
}

function applyControls(rows, controls, prices, userId) {
  const choose = (items, key) => {
    const active = items.filter(item => item.entity_key === key || item.action_code === key).filter(activeWindow);
    return active.find(item => item.scope_type === 'user' && Number(item.scope_user_id) === Number(userId)) ||
      active.find(item => item.scope_type === 'platform') || null;
  };
  return rows.map(row => {
    const control = choose(controls, row.action_code);
    const price = choose(prices, row.action_code);
    const original = { base_credits:Number(row.base_credits||0), minimum_credits:Number(row.minimum_credits||0), maximum_credits:row.maximum_credits==null?null:Number(row.maximum_credits), pricing_config:parseJson(row.pricing_config_json) };
    return {
      ...row,
      base_credits: price?.override_base_credits ?? row.base_credits,
      minimum_credits: price?.override_minimum_credits ?? row.minimum_credits,
      maximum_credits: price?.override_maximum_credits ?? row.maximum_credits,
      pricing_config_json: price?.override_pricing_json ?? row.pricing_config_json,
      effective_enabled: control ? Boolean(control.enabled) : true,
      original_pricing: original,
      price_override_scope: price?.scope_type || null,
      visibility_override_scope: control?.scope_type || null
    };
  });
}

async function listCatalog(db, { activeOnly = true, userId = null, includeDisabled = false } = {}) {
  const where = activeOnly ? 'WHERE a.active=1 AND m.lifecycle_status<>\'retired\'' : '';
  const [rows] = await db.query(
    `SELECT a.*,m.name module_name,m.module_type,m.version module_version,m.lifecycle_status module_status
     FROM action_catalog a JOIN app_modules m ON m.module_key=a.module_key
     ${where} ORDER BY a.category,a.name`
  );
  let effectiveRows=rows;
  if(userId){
    const [controls]=await db.execute(`SELECT entity_key,scope_type,scope_user_id,enabled,effective_from,effective_until FROM feature_control_overrides WHERE entity_type='action' AND (scope_type='platform' OR scope_user_id=?)`,[userId]);
    const [prices]=await db.execute(`SELECT action_code,scope_type,scope_user_id,override_base_credits,override_minimum_credits,override_maximum_credits,override_pricing_json,effective_from,effective_until FROM action_price_overrides WHERE scope_type='platform' OR scope_user_id=?`,[userId]);
    effectiveRows=applyControls(rows,controls,prices,userId);
    if(!includeDisabled)effectiveRows=effectiveRows.filter(row=>row.effective_enabled);
  }
  return effectiveRows.map(row => ({
    ...row,
    pricing_config: parseJson(row.pricing_config_json),
    output_contract: parseJson(row.output_contract_json)
  }));
}

async function getAction(db, actionCode, userId = null) {
  const rows=await listCatalog(db,{activeOnly:true,userId,includeDisabled:true});
  const action=rows.find(row=>row.action_code===actionCode)||null;
  if(action&&!action.effective_enabled)return null;
  return action;
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
