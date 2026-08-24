const crypto = require('crypto');
const express = require('express');

const POWER_ENTITLEMENT = 'swarm_super_admin';

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createSwarmPowerRouter({ db, session }) {
  const router = express.Router();

  async function requireVinny(req, res, next) {
    const current = session(req);
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
              independently_selectable,core_version,metadata_json
       FROM swarm_bots WHERE lifecycle_status<>'retired' ORDER BY name`
    );
    res.json({ ok: true, bots });
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

