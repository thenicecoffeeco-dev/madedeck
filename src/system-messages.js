const crypto = require('crypto');
const express = require('express');
const path = require('path');

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
  if (rule.accountIds && !rule.accountIds.map(Number).includes(Number(context.accountId))) return false;
  if (rule.accountKeys && !rule.accountKeys.includes(context.accountKey)) return false;
  if (rule.storeIds && !rule.storeIds.map(Number).includes(Number(context.storeId))) return false;
  if (rule.profileKeys && !rule.profileKeys.includes(context.profileKey)) return false;
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
    let membership = null;
    if (user) {
      const [memberships] = await db().execute(
        `SELECT am.account_id,am.store_id,am.profile_key,am.role_key,a.account_key
         FROM account_memberships am JOIN accounts a ON a.id=am.account_id
         WHERE am.user_id=? AND am.status='active' AND a.status='active'
         ORDER BY (a.account_key='madedeck') DESC,am.id LIMIT 20`,
        [user.id]
      );
      const requested = String(req.query.account_key || '').trim();
      membership = (requested && memberships.find(row => row.account_key === requested)) || memberships[0] || null;
    }
    return {
      user, tier,
      accountId: membership?.account_id || null,
      accountKey: membership?.account_key || null,
      storeId: membership?.store_id || null,
      profileKey: membership?.profile_key || null,
      role: membership?.role_key || user?.role || null,
      channel: CHANNELS.has(req.query.channel) ? req.query.channel : 'web'
    };
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
              icon_key,audience_json,account_id,store_id,profile_key,countdown_at,starts_at,ends_at,priority,dismissible,
              requires_acknowledgment,sticky_until_resolved,published_at
       FROM system_messages
       WHERE status IN ('published','scheduled') AND (starts_at IS NULL OR starts_at<=NOW())
         AND (ends_at IS NULL OR ends_at>NOW())
       ORDER BY priority DESC,published_at DESC LIMIT 100`
    );
    const messages = rows.filter(row =>
      (!row.account_id || Number(row.account_id) === Number(current.accountId)) &&
      (!row.store_id || Number(row.store_id) === Number(current.storeId)) &&
      (!row.profile_key || row.profile_key === current.profileKey) &&
      audienceMatches(row.audience_json, current)
    ).map(row => ({
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
    const [messages] = await db().execute(
      'SELECT id,requires_acknowledgment,account_id,store_id,profile_key,audience_json FROM system_messages WHERE message_key=? LIMIT 1',
      [req.params.messageKey]
    );
    const message = messages[0];
    const allowed = message &&
      (!message.account_id || Number(message.account_id) === Number(current.accountId)) &&
      (!message.store_id || Number(message.store_id) === Number(current.storeId)) &&
      (!message.profile_key || message.profile_key === current.profileKey) &&
      audienceMatches(message.audience_json, current);
    if (!allowed) return res.status(404).json({ ok: false, error: 'message_not_found' });
    const column = { seen:'first_seen_at',read:'read_at',dismissed:'dismissed_at',acknowledged:'acknowledged_at' }[event];
    await db().execute(
      `INSERT INTO system_message_receipts(message_id,user_id,channel,${column},last_seen_at)
       VALUES(?,?,?,NOW(),NOW()) ON DUPLICATE KEY UPDATE ${column}=COALESCE(${column},NOW()),last_seen_at=NOW()`,
      [message.id, current.user.id, channel]
    );
    res.json({ ok: true, event });
  });

  router.get('/admin/messages', requireOwner, async (req, res) => {
    const [messages] = await db().query('SELECT * FROM system_messages ORDER BY created_at DESC LIMIT 300');
    res.json({ ok: true, messages: messages.map(item => ({ ...item, audience: json(item.audience_json, {}) })) });
  });

  router.get('/admin/ui', requireOwner, (req, res) => {
    res.sendFile(path.join(__dirname, '../private/system-communications.html'));
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
       (message_key,created_by_user_id,account_id,store_id,profile_key,message_type,severity,presentation,status,title,body,action_label,
        action_url,icon_key,audience_json,countdown_at,starts_at,ends_at,priority,dismissible,
        requires_acknowledgment,sticky_until_resolved,published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,IF(?='published',NOW(),NULL))`,
      [key,req.user.id,body.account_id||null,body.store_id||null,body.profile_key||null,type,severity,presentation,status,title,messageBody,body.action_label||null,
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

  router.post('/admin/components/:componentKey', requireOwner, async (req, res) => {
    const status = ['operational','degraded','partial_outage','major_outage','maintenance'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ ok: false, error: 'invalid_component_status' });
    const [result] = await db().execute('UPDATE system_status_components SET status=? WHERE component_key=?', [status,req.params.componentKey]);
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'component_not_found' });
    res.json({ ok: true, component_key: req.params.componentKey, status });
  });

  router.post('/admin/incidents', requireOwner, async (req, res) => {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'title_required' });
    const severity = ['minor','major','critical'].includes(req.body.severity) ? req.body.severity : 'minor';
    const components = Array.isArray(req.body.affected_components) ? req.body.affected_components.map(String) : [];
    const incidentKey = crypto.randomUUID();
    await db().execute(
      `INSERT INTO system_incidents
       (incident_key,created_by_user_id,title,severity,state,affected_components_json,started_at,public_visible)
       VALUES(?,?,?,?,'investigating',?,COALESCE(?,NOW()),?)`,
      [incidentKey,req.user.id,title,severity,JSON.stringify(components),req.body.started_at||null,req.body.public_visible!==false]
    );
    res.status(201).json({ ok: true, incident_key: incidentKey, state: 'investigating' });
  });

  router.post('/admin/incidents/:incidentKey/updates', requireOwner, async (req, res) => {
    const state = ['investigating','identified','monitoring','resolved'].includes(req.body?.state) ? req.body.state : null;
    const body = String(req.body?.body || '').trim();
    if (!state || !body) return res.status(400).json({ ok: false, error: 'state_and_body_required' });
    const [incidents] = await db().execute('SELECT id FROM system_incidents WHERE incident_key=? LIMIT 1', [req.params.incidentKey]);
    if (!incidents[0]) return res.status(404).json({ ok: false, error: 'incident_not_found' });
    await db().execute('INSERT INTO system_incident_updates(incident_id,created_by_user_id,state,body) VALUES(?,?,?,?)', [incidents[0].id,req.user.id,state,body]);
    await db().execute(`UPDATE system_incidents SET state=?,resolved_at=IF(?='resolved',NOW(),NULL) WHERE id=?`, [state,state,incidents[0].id]);
    res.json({ ok: true, state });
  });

  router.get('/admin/releases', requireOwner, async (req, res) => {
    const [releases] = await db().query('SELECT * FROM release_notes ORDER BY created_at DESC LIMIT 200');
    res.json({ ok: true, releases: releases.map(item => ({ ...item, sections: json(item.sections_json, []), audience: json(item.audience_json, {}) })) });
  });

  router.post('/admin/releases', requireOwner, async (req, res) => {
    const version = String(req.body?.version || '').trim();
    const title = String(req.body?.title || '').trim();
    const summary = String(req.body?.summary || '').trim();
    if (!version || !title || !summary) return res.status(400).json({ ok: false, error: 'version_title_summary_required' });
    const platform = ['all','web','desktop','server'].includes(req.body.platform) ? req.body.platform : 'all';
    const releaseKey = crypto.randomUUID();
    const status = req.body.publish_now === true ? 'published' : 'draft';
    await db().execute(
      `INSERT INTO release_notes
       (release_key,version,platform,title,summary,sections_json,audience_json,status,published_at,created_by_user_id)
       VALUES(?,?,?,?,?,?,?,?,IF(?='published',NOW(),NULL),?)`,
      [releaseKey,version,platform,title,summary,JSON.stringify(req.body.sections||[]),JSON.stringify(req.body.audience||{public:true,channels:['web','desktop']}),status,status,req.user.id]
    );
    res.status(201).json({ ok: true, release_key: releaseKey, status });
  });

  return router;
}

module.exports = { audienceMatches, createSystemMessagesRouter };
