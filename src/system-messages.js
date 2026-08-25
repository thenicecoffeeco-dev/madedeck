const crypto = require('crypto');
const express = require('express');

const TYPES = new Set(['general','release_note','maintenance','outage','upgrade','security','billing','promotion']);
const SEVERITIES = new Set(['info','success','warning','critical']);
const PRESENTATIONS = new Set(['banner','modal','toast','inbox','fullscreen']);
const CHANNELS = new Set(['web','desktop']);

function json(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function cleanEmail(value) { return String(value || '').trim().toLowerCase(); }

function audienceMatches(audience, context) {
  const rule = json(audience, {});
  if (rule.public === true) return !rule.channels || rule.channels.includes(context.channel);
  if (!context.user) return false;
  if (rule.channels && !rule.channels.includes(context.channel)) return false;
  if (rule.userIds && !rule.userIds.map(Number).includes(Number(context.user.id))) return false;
  if (rule.roles && !rule.roles.includes(context.user.role)) return false;
  if (rule.tiers && !rule.tiers.includes(context.tier)) return false;
  return true;
}

function createSystemMessagesRouter({ db, session }) {
  const router = express.Router();

  async function context(req) {
    const user = await session(req);
    let tier = 'FREE';
    if (user) {
      const [rows] = await db().execute(
        `SELECT tier_code FROM user_subscriptions
         WHERE user_id=? AND status IN ('active','trialing')
           AND (current_period_end IS NULL OR current_period_end>NOW())
         ORDER BY FIELD(tier_code,'COMMAND_CENTER','ADVANCED','PRO') LIMIT 1`,
        [user.id]
      );
      tier = rows[0]?.tier_code || 'FREE';
    }
    return { user, tier, channel: CHANNELS.has(req.query.channel) ? req.query.channel : 'web' };
  }

  async function requireOwner(req, res, next) {
    const current = await session(req);
    const ownerEmail = cleanEmail(process.env.VINNY_OWNER_EMAIL);
    if (!current) return res.status(401).json({ ok: false, error: 'login_required' });
    if (!ownerEmail || current.role !== 'platform_admin' || cleanEmail(current.email) !== ownerEmail) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    req.user = current;
    next();
  }

  router.get('/feed', async (req, res) => {
    const current = await context(req);
    const [rows] = await db().query(
      `SELECT message_key,message_type,severity,presentation,title,body,action_label,action_url,
              icon_key,audience_json,countdown_at,starts_at,ends_at,priority,dismissible,
              requires_acknowledgment,sticky_until_resolved,published_at
       FROM system_messages
       WHERE status IN ('published','scheduled') AND (starts_at IS NULL OR starts_at<=NOW())
         AND (ends_at IS NULL OR ends_at>NOW())
       ORDER BY priority DESC,published_at DESC LIMIT 100`
    );
    const messages = rows.filter(row => audienceMatches(row.audience_json, current)).map(row => ({
      ...row, audience: undefined, audience_json: undefined,
      countdown_at: row.countdown_at ? new Date(row.countdown_at).toISOString() : null
    }));
    const [components] = await db().query(
      `SELECT component_key,name,description,status,updated_at
       FROM system_status_components WHERE public_visible=1 ORDER BY sort_order,name`
    );
    const [incidents] = await db().query(
      `SELECT incident_key,title,severity,state,affected_components_json,started_at,resolved_at,updated_at
       FROM system_incidents WHERE public_visible=1 AND state<>'canceled'
         AND (state<>'resolved' OR resolved_at>DATE_SUB(NOW(),INTERVAL 24 HOUR))
       ORDER BY started_at DESC LIMIT 20`
    );
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, server_time: new Date().toISOString(), channel: current.channel, messages, components,
      incidents: incidents.map(item => ({ ...item, affected_components: json(item.affected_components_json, []), affected_components_json: undefined })) });
  });

  router.post('/:messageKey/receipt', async (req, res) => {
    const current = await context(req);
    if (!current.user) return res.status(401).json({ ok: false, error: 'login_required' });
    const event = ['seen','read','dismissed','acknowledged'].includes(req.body?.event) ? req.body.event : 'seen';
    const channel = CHANNELS.has(req.body?.channel) ? req.body.channel : current.channel;
    const [messages] = await db().execute('SELECT id,requires_acknowledgment FROM system_messages WHERE message_key=? LIMIT 1', [req.params.messageKey]);
    if (!messages[0]) return res.status(404).json({ ok: false, error: 'message_not_found' });
    const column = { seen:'first_seen_at',read:'read_at',dismissed:'dismissed_at',acknowledged:'acknowledged_at' }[event];
    await db().execute(
      `INSERT INTO system_message_receipts(message_id,user_id,channel,${column},last_seen_at)
       VALUES(?,?,?,NOW(),NOW()) ON DUPLICATE KEY UPDATE ${column}=COALESCE(${column},NOW()),last_seen_at=NOW()`,
      [messages[0].id, current.user.id, channel]
    );
    res.json({ ok: true, event });
  });

  router.get('/admin/messages', requireOwner, async (req, res) => {
    const [messages] = await db().query('SELECT * FROM system_messages ORDER BY created_at DESC LIMIT 300');
    res.json({ ok: true, messages: messages.map(item => ({ ...item, audience: json(item.audience_json, {}) })) });
  });

  router.post('/admin/messages', requireOwner, async (req, res) => {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const messageBody = String(body.body || '').trim();
    if (!title || !messageBody) return res.status(400).json({ ok: false, error: 'title_and_body_required' });
    const key = crypto.randomUUID();
    const type = TYPES.has(body.message_type) ? body.message_type : 'general';
    const severity = SEVERITIES.has(body.severity) ? body.severity : 'info';
    const presentation = PRESENTATIONS.has(body.presentation) ? body.presentation : 'banner';
    const status = body.publish_now === true ? 'published' : (body.starts_at ? 'scheduled' : 'draft');
    const audience = body.audience && typeof body.audience === 'object' ? body.audience : { public: false, roles: ['platform_admin'], channels: ['web','desktop'] };
    await db().execute(
      `INSERT INTO system_messages
       (message_key,created_by_user_id,message_type,severity,presentation,status,title,body,action_label,
        action_url,icon_key,audience_json,countdown_at,starts_at,ends_at,priority,dismissible,
        requires_acknowledgment,sticky_until_resolved,published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,IF(?='published',NOW(),NULL))`,
      [key,req.user.id,type,severity,presentation,status,title,messageBody,body.action_label||null,
       body.action_url||null,body.icon_key||null,JSON.stringify(audience),body.countdown_at||null,
       body.starts_at||null,body.ends_at||null,Number(body.priority||50),body.dismissible!==false,
       body.requires_acknowledgment===true,body.sticky_until_resolved===true,status]
    );
    res.status(201).json({ ok: true, message_key: key, status });
  });

  router.post('/admin/messages/:messageKey/state', requireOwner, async (req, res) => {
    const state = ['published','paused','canceled','expired'].includes(req.body.status) ? req.body.status : null;
    if (!state) return res.status(400).json({ ok: false, error: 'invalid_status' });
    const [result] = await db().execute(
      `UPDATE system_messages SET status=?,published_at=IF(?='published',COALESCE(published_at,NOW()),published_at)
       WHERE message_key=?`, [state,state,req.params.messageKey]
    );
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'message_not_found' });
    res.json({ ok: true, status: state });
  });

  router.get('/admin/status', requireOwner, async (req, res) => {
    const [components] = await db().query('SELECT * FROM system_status_components ORDER BY sort_order,name');
    const [incidents] = await db().query('SELECT * FROM system_incidents ORDER BY started_at DESC LIMIT 100');
    res.json({ ok: true, components, incidents });
  });

  return router;
}

module.exports = { audienceMatches, createSystemMessagesRouter };
