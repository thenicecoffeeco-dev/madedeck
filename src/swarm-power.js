const crypto = require('crypto');
const express = require('express');
const path = require('path');
const actionCatalog = require('./action-catalog');

const POWER_ENTITLEMENT = 'swarm_super_admin';

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createSwarmPowerRouter({ db, session }) {
  const router = express.Router();

  async function requireVinny(req, res, next) {
    const current = await session(req);
    const ownerEmail = cleanEmail(process.env.VINNY_OWNER_EMAIL);
    if (!current) return res.status(401).json({ ok: false, error: 'login_required' });
    if (!ownerEmail) return res.status(503).json({ ok: false, error: 'vinny_owner_not_configured' });
    if (current.role !== 'platform_admin' || cleanEmail(current.email) !== ownerEmail) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const [rows] = await db().execute(
      `SELECT id FROM user_entitlements
       WHERE user_id=? AND entitlement_key=? AND enabled=1
         AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1`,
      [current.id, POWER_ENTITLEMENT]
    );
    if (!rows[0]) return res.status(403).json({ ok: false, error: 'entitlement_required' });
    req.user = current;
    next();
  }

  router.use(requireVinny);

  router.get('/ui', (req, res) => res.sendFile(path.join(__dirname, '../private/power-console.html')));

  router.get('/context', async (req, res) => {
    const [[botCount]] = await db().query('SELECT COUNT(*) total FROM swarm_bots WHERE lifecycle_status<>\'retired\'');
    const [[missionCount]] = await db().query('SELECT COUNT(*) total FROM swarm_missions');
    const [[approvalCount]] = await db().query("SELECT COUNT(*) total FROM swarm_approvals WHERE status='pending'");
    res.json({
      ok: true,
      mode: 'vinny_only',
      user: { id: req.user.id, email: req.user.email, role: req.user.role },
      counts: { bots: Number(botCount.total), missions: Number(missionCount.total), pendingApprovals: Number(approvalCount.total) }
    });
  });

  router.get('/bots', async (req, res) => {
    const [bots] = await db().query(
      `SELECT bot_key,name,primary_capability,autonomy,lifecycle_status,
              independently_selectable,operator_enabled,system_required,core_version,metadata_json
       FROM swarm_bots WHERE lifecycle_status<>'retired' ORDER BY name`
    );
    res.json({ ok: true, bots });
  });

  router.post('/bots/:botKey/toggle', async (req, res) => {
    const enabled = req.body.enabled === true;
    const [rows] = await db().execute('SELECT id,bot_key,name,lifecycle_status,system_required FROM swarm_bots WHERE bot_key=? LIMIT 1', [req.params.botKey]);
    const bot = rows[0];
    if (!bot) return res.status(404).json({ ok: false, error: 'bot_not_found' });
    if (bot.system_required && !enabled) return res.status(409).json({ ok: false, error: 'system_required' });
    if (bot.lifecycle_status === 'blocked' && enabled) return res.status(409).json({ ok: false, error: 'bot_dependencies_blocked' });
    await db().execute('UPDATE swarm_bots SET operator_enabled=? WHERE id=?', [enabled ? 1 : 0, bot.id]);
    await db().execute(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,detail_json) VALUES(?,'swarm.bot.toggle','swarm_bot',?,?)`, [req.user.id, bot.bot_key, JSON.stringify({ enabled })]);
    res.json({ ok: true, bot_key: bot.bot_key, operator_enabled: enabled });
  });

  router.get('/functions', async (req, res) => {
    const [functions] = await db().query(`SELECT function_key,name,category,invocation_mode,readiness,operator_visible,operator_enabled,authority_ceiling,worker_key FROM power_functions WHERE operator_visible=1 AND readiness<>'retired' ORDER BY category,name`);
    res.json({ ok: true, functions });
  });

  router.get('/modules', async (req, res) => {
    const [modules] = await db().query(
      `SELECT module_key,name,module_type,version,lifecycle_status,entrypoint,manifest_json
       FROM app_modules WHERE lifecycle_status<>'retired' ORDER BY module_type,name`
    );
    const [products] = await db().query(
      `SELECT product_type_key,module_key,name,editor_adapter,active,supports_color_variants,
              supports_multiple_views,supports_vector_export,supports_cutline,configuration_json
       FROM product_customizer_modules WHERE active=1 ORDER BY name`
    );
    res.json({
      ok: true,
      modules: modules.map(item => ({ ...item, manifest: actionCatalog.parseJson(item.manifest_json) })),
      product_customizers: products.map(item => ({ ...item, configuration: actionCatalog.parseJson(item.configuration_json) }))
    });
  });

  router.get('/catalog', async (req, res) => {
    const actions = await actionCatalog.listCatalog(db());
    const balance = await actionCatalog.getCreditBalance(db(), req.user.id);
    const [offers] = await db().query(
      `SELECT offer_code,name,purchase_mode,tier_code,entitlement_key,credit_grant,active,config_json
       FROM billing_offers ORDER BY purchase_mode,name`
    );
    res.json({
      ok: true,
      balance,
      actions,
      offers: offers.map(offer => ({ ...offer, config: actionCatalog.parseJson(offer.config_json) }))
    });
  });

  router.post('/catalog/:actionCode/estimate', async (req, res) => {
    const action = await actionCatalog.getAction(db(), req.params.actionCode);
    if (!action) return res.status(404).json({ ok: false, error: 'action_not_found' });
    if (action.module_status !== 'ready' && action.module_status !== 'foundation') {
      return res.status(409).json({ ok: false, error: 'module_unavailable', module_status: action.module_status });
    }
    const estimate = actionCatalog.calculateEstimate(action, req.body || {});
    const balance = await actionCatalog.getCreditBalance(db(), req.user.id);
    res.json({ ok: true, estimate, balance, affordable: estimate.credits <= balance.available });
  });

  router.post('/functions/:functionKey/jobs', async (req, res) => {
    const [rows] = await db().execute('SELECT id,function_key,invocation_mode,readiness,operator_enabled,authority_ceiling FROM power_functions WHERE function_key=? LIMIT 1', [req.params.functionKey]);
    const fn = rows[0];
    if (!fn) return res.status(404).json({ ok: false, error: 'function_not_found' });
    if (!fn.operator_enabled) return res.status(409).json({ ok: false, error: 'function_disabled' });
    if (!['standalone','both'].includes(fn.invocation_mode)) return res.status(409).json({ ok: false, error: 'standalone_not_supported' });
    if (fn.readiness !== 'ready') return res.status(409).json({ ok: false, error: 'function_not_ready', readiness: fn.readiness });
    const jobKey = crypto.randomUUID();
    await db().execute(`INSERT INTO power_jobs(job_key,function_id,requested_by_user_id,invocation_mode,state,input_json) VALUES(?,?,?,'standalone','queued',?)`, [jobKey, fn.id, req.user.id, JSON.stringify(req.body.input || {})]);
    await db().execute(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,detail_json) VALUES(?,'power.job.create','power_job',?,?)`, [req.user.id, jobKey, JSON.stringify({ function_key: fn.function_key, mode: 'standalone' })]);
    res.status(202).json({ ok: true, job_key: jobKey, state: 'queued', function_key: fn.function_key });
  });

  router.get('/missions', async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const [missions] = await db().execute(
      `SELECT mission_key,title,authority_class,state,evidence_mode,started_at,completed_at,created_at,updated_at
       FROM swarm_missions ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    res.json({ ok: true, missions });
  });

  router.post('/missions', async (req, res) => {
    const title = String(req.body.title || '').trim();
    const requestText = String(req.body.request_text || '').trim();
    const authority = ['A0','A1','A2','A3','A4','A5'].includes(req.body.authority_class)
      ? req.body.authority_class : 'A1';
    if (!title || !requestText) return res.status(400).json({ ok: false, error: 'title_and_request_required' });

    const missionKey = crypto.randomUUID();
    const contract = req.body.mission_contract && typeof req.body.mission_contract === 'object'
      ? JSON.stringify(req.body.mission_contract) : null;
    await db().execute(
      `INSERT INTO swarm_missions
       (mission_key,requested_by_user_id,store_id,title,request_text,authority_class,state,evidence_mode,mission_contract_json)
       VALUES(?,?,?,?,?,?,'draft',?,?)`,
      [missionKey, req.user.id, req.body.store_id || null, title, requestText, authority, String(req.body.evidence_mode || 'hybrid'), contract]
    );
    await db().execute(
      `INSERT INTO audit_log(actor_user_id,store_id,action,entity_type,entity_id,detail_json)
       VALUES(?,?,'swarm.mission.create','swarm_mission',?,?)`,
      [req.user.id, req.body.store_id || null, missionKey, JSON.stringify({ authority })]
    );
    res.status(201).json({ ok: true, mission_key: missionKey, state: 'draft' });
  });

  router.post('/missions/:missionKey/select-bots', async (req, res) => {
    const botKeys = Array.isArray(req.body.bot_keys) ? [...new Set(req.body.bot_keys.map(String))] : [];
    if (!botKeys.length) return res.status(400).json({ ok: false, error: 'bot_keys_required' });
    const placeholders = botKeys.map(() => '?').join(',');
    const [missions] = await db().execute('SELECT id,state FROM swarm_missions WHERE mission_key=? LIMIT 1', [req.params.missionKey]);
    const mission = missions[0];
    if (!mission) return res.status(404).json({ ok: false, error: 'mission_not_found' });
    if (!['draft','queued','blocked'].includes(mission.state)) return res.status(409).json({ ok: false, error: 'mission_not_selectable' });
    const [bots] = await db().execute(
      `SELECT id,bot_key,lifecycle_status,independently_selectable FROM swarm_bots WHERE bot_key IN (${placeholders})`, botKeys
    );
    const unavailable = bots.filter(bot => !bot.independently_selectable || ['blocked','retired'].includes(bot.lifecycle_status));
    if (unavailable.length) return res.status(409).json({ ok: false, error: 'bot_unavailable', bots: unavailable.map(b => b.bot_key) });
    if (bots.length !== botKeys.length) return res.status(400).json({ ok: false, error: 'unknown_bot_key' });
    for (const bot of bots) {
      await db().execute(
        `INSERT INTO swarm_mission_bots(mission_id,bot_id,assignment_state)
         VALUES(?,?,'selected') ON DUPLICATE KEY UPDATE assignment_state='selected'`,
        [mission.id, bot.id]
      );
    }
    res.json({ ok: true, selected: bots.map(b => b.bot_key) });
  });

  return router;
}

async function ensureVinnyEntitlement(db) {
  const ownerEmail = cleanEmail(process.env.VINNY_OWNER_EMAIL);
  if (!ownerEmail) return { configured: false, granted: false };
  const [users] = await db().execute("SELECT id,role FROM users WHERE email=? AND status='active' LIMIT 1", [ownerEmail]);
  const owner = users[0];
  if (!owner || owner.role !== 'platform_admin') return { configured: true, granted: false };
  await db().execute(
    `INSERT INTO user_entitlements(user_id,entitlement_key,enabled,granted_by_user_id)
     VALUES(?,?,1,?) ON DUPLICATE KEY UPDATE enabled=1,expires_at=NULL,granted_by_user_id=VALUES(granted_by_user_id)`,
    [owner.id, POWER_ENTITLEMENT, owner.id]
  );
  return { configured: true, granted: true };
}

module.exports = { createSwarmPowerRouter, ensureVinnyEntitlement };

