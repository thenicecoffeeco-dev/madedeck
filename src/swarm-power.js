const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
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
    const actions = await actionCatalog.listCatalog(db(),{userId:req.user.id});
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

  router.get('/admin/feature-controls', async (req, res) => {
    const userId=req.query.user_id?Number(req.query.user_id):req.user.id;
    if(!Number.isInteger(userId)||userId<1)return res.status(400).json({ok:false,error:'invalid_user_id'});
    const actions=await actionCatalog.listCatalog(db(),{userId,includeDisabled:true});
    const [users]=await db().query(`SELECT id,email,role,status FROM users WHERE status='active' ORDER BY email LIMIT 500`);
    res.json({ok:true,scope_user_id:userId,users,actions});
  });

  router.get('/admin/saas-overview', async (req, res) => {
    const [[users]] = await db().query(`SELECT COUNT(*) total, SUM(status='active') active, SUM(created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)) new_30d FROM users`);
    const [[subscriptions]] = await db().query(`SELECT COUNT(*) total, SUM(status IN ('active','trialing')) active, SUM(status='past_due') past_due, SUM(cancel_at_period_end=1) canceling FROM user_subscriptions`);
    const [[revenue]] = await db().query(`SELECT COALESCE(SUM(CASE WHEN p.status='paid' THEN p.amount_total ELSE 0 END),0) lifetime_cents, COALESCE(SUM(CASE WHEN p.status='paid' AND p.created_at>=DATE_FORMAT(NOW(),'%Y-%m-01') THEN p.amount_total ELSE 0 END),0) month_cents FROM purchase_log p`);
    const [[credits]] = await db().query(`SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) issued, COALESCE(-SUM(CASE WHEN amount<0 THEN amount ELSE 0 END),0) used, COALESCE(SUM(amount),0) outstanding FROM credit_ledger WHERE expires_at IS NULL OR expires_at>NOW()`);
    const [[dialer]] = await db().query(`SELECT COUNT(*) accounts, SUM(subscription_status IN ('active','trialing')) active, COALESCE(SUM(calls_used),0) calls_used FROM dialer_accounts`);
    const [[inquiries]] = await db().query(`SELECT COUNT(*) total, SUM(status='new') new_count, SUM(status IN ('qualified','proposal')) pipeline FROM sales_inquiries`);
    const [[usage]] = await db().query(`SELECT COUNT(*) events, COALESCE(SUM(credits_charged),0) credits, COALESCE(SUM(revenue_cents),0) revenue_cents FROM action_usage_events WHERE created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)`);
    const [planMix] = await db().query(`SELECT bo.name,us.tier_code,COUNT(*) subscribers FROM user_subscriptions us JOIN billing_offers bo ON bo.id=us.billing_offer_id WHERE us.status IN ('active','trialing') GROUP BY bo.name,us.tier_code ORDER BY subscribers DESC`);
    const [topActions] = await db().query(`SELECT a.action_code,a.name,COUNT(e.id) runs,COALESCE(SUM(e.quantity),0) quantity,COALESCE(SUM(e.credits_charged),0) credits FROM action_catalog a LEFT JOIN action_usage_events e ON e.action_code=a.action_code AND e.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY a.action_code,a.name ORDER BY runs DESC,a.name LIMIT 12`);
    res.json({ok:true,users,subscriptions,revenue,credits,dialer,inquiries,usage,plan_mix:planMix,top_actions:topActions});
  });

  router.get('/admin/customers', async (req, res) => {
    const search=String(req.query.search||'').trim();
    const pattern=`%${search}%`;
    const [customers]=await db().execute(`SELECT u.id,u.email,u.role,u.status,u.created_at,us.tier_code,us.status subscription_status,us.current_period_end,bo.name plan_name,COALESCE((SELECT SUM(cl.amount) FROM credit_ledger cl WHERE cl.user_id=u.id AND (cl.expires_at IS NULL OR cl.expires_at>NOW())),0) credit_balance,COALESCE(da.plan_code,'') dialer_plan,COALESCE(da.subscription_status,'inactive') dialer_status,COALESCE(da.calls_used,0) calls_used,COALESCE((SELECT SUM(pl.amount_total) FROM purchase_log pl WHERE pl.user_id=u.id AND pl.status='paid'),0) lifetime_value_cents FROM users u LEFT JOIN user_subscriptions us ON us.id=(SELECT us2.id FROM user_subscriptions us2 WHERE us2.user_id=u.id ORDER BY us2.created_at DESC LIMIT 1) LEFT JOIN billing_offers bo ON bo.id=us.billing_offer_id LEFT JOIN dialer_accounts da ON da.user_id=u.id WHERE (?='' OR u.email LIKE ?) ORDER BY u.created_at DESC LIMIT 500`,[search,pattern]);
    res.json({ok:true,customers});
  });

  router.get('/admin/inquiries', async (req, res) => {
    const [inquiries]=await db().query(`SELECT inquiry_key,email,name,company,phone,interest_code,source,status,estimated_value_cents,message,created_at,updated_at FROM sales_inquiries ORDER BY FIELD(status,'new','contacted','qualified','proposal','won','lost','spam'),created_at DESC LIMIT 500`);
    res.json({ok:true,inquiries});
  });

  router.get('/admin/commerce-controls', async (req, res) => {
    const userId=req.query.user_id?Number(req.query.user_id):null;
    const [offers]=await db().execute(`SELECT bo.offer_code entity_key,bo.name,bo.purchase_mode category,bo.tier_code,bo.credit_grant original_credit_grant,bo.active,bo.config_json,COALESCE(co.override_price_cents,CAST(JSON_UNQUOTE(JSON_EXTRACT(bo.config_json,'$.displayPriceUsd')) AS DECIMAL(12,2))*100) effective_price_cents,co.override_price_cents,COALESCE(co.override_credit_grant,bo.credit_grant) effective_credit_grant,co.override_credit_grant FROM billing_offers bo LEFT JOIN commerce_overrides co ON co.entity_type='offer' AND co.entity_key=bo.offer_code AND co.scope_type=? AND co.scope_user_id <=> ? ORDER BY FIELD(bo.purchase_mode,'subscription','payment','free'),bo.name`,[userId?'user':'platform',userId]);
    const [dialerPlans]=await db().execute(`SELECT dp.plan_code entity_key,dp.name,'dialer' category,dp.monthly_price_cents original_price_cents,dp.included_calls original_allowance,dp.active,COALESCE(co.override_price_cents,dp.monthly_price_cents) effective_price_cents,co.override_price_cents,COALESCE(co.override_allowance,dp.included_calls) effective_allowance,co.override_allowance,dp.feature_json FROM dialer_plans dp LEFT JOIN commerce_overrides co ON co.entity_type='dialer_plan' AND co.entity_key=dp.plan_code AND co.scope_type=? AND co.scope_user_id <=> ? ORDER BY dp.monthly_price_cents`,[userId?'user':'platform',userId]);
    const actions=await actionCatalog.listCatalog(db(),{userId:userId||req.user.id,includeDisabled:true});
    const [allowances]=await db().query(`SELECT paa.tier_code,paa.action_code,ac.name,paa.included_quantity,paa.allowance_period,paa.overage_credit_multiplier FROM plan_action_allowances paa JOIN action_catalog ac ON ac.action_code=paa.action_code ORDER BY paa.tier_code,ac.name`);
    res.json({ok:true,offers:offers.map(o=>({...o,config:actionCatalog.parseJson(o.config_json),original_price_cents:Number((actionCatalog.parseJson(o.config_json).displayPriceUsd||0)*100)})),dialer_plans:dialerPlans.map(p=>({...p,features:actionCatalog.parseJson(p.feature_json)})),actions,allowances});
  });

  router.put('/admin/commerce-controls/:entityType/:entityKey', async (req, res) => {
    const entityType=req.params.entityType==='dialer_plan'?'dialer_plan':'offer';
    const scopeType=req.body.scope_type==='user'?'user':'platform';
    const scopeUserId=scopeType==='user'?Number(req.body.scope_user_id):null;
    if(scopeType==='user'&&(!Number.isInteger(scopeUserId)||scopeUserId<1))return res.status(400).json({ok:false,error:'scope_user_required'});
    const price=req.body.override_price_cents===''||req.body.override_price_cents==null?null:Number(req.body.override_price_cents);
    const credits=req.body.override_credit_grant===''||req.body.override_credit_grant==null?null:Number(req.body.override_credit_grant);
    const allowance=req.body.override_allowance===''||req.body.override_allowance==null?null:Number(req.body.override_allowance);
    if([price,credits,allowance].some(v=>v!==null&&(!Number.isInteger(v)||v<0)))return res.status(400).json({ok:false,error:'invalid_override'});
    await db().execute(`INSERT INTO commerce_overrides(entity_type,entity_key,scope_type,scope_user_id,override_price_cents,override_credit_grant,override_allowance,reason,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE override_price_cents=VALUES(override_price_cents),override_credit_grant=VALUES(override_credit_grant),override_allowance=VALUES(override_allowance),reason=VALUES(reason),updated_by_user_id=VALUES(updated_by_user_id)`,[entityType,req.params.entityKey,scopeType,scopeUserId,price,credits,allowance,String(req.body.reason||'').slice(0,500)||null,req.user.id]);
    if(typeof req.body.active==='boolean'){
      const table=entityType==='offer'?'billing_offers':'dialer_plans',key=entityType==='offer'?'offer_code':'plan_code';
      await db().execute(`UPDATE ${table} SET active=? WHERE ${key}=?`,[req.body.active?1:0,req.params.entityKey]);
    }
    res.json({ok:true,entity_type:entityType,entity_key:req.params.entityKey,scope_type:scopeType,scope_user_id:scopeUserId});
  });

  router.get('/admin/assets-status', async (req, res) => {
    const readManifest=relative=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'../public',relative),'utf8'));}catch(error){return {count:0,assets:[],error:'manifest_missing'};}};
    const mockups=readManifest('mockups/manifest.json'),premades=readManifest('premades/manifest.json');
    const products={};
    for(const asset of mockups.assets||[]){products[asset.product]||={count:0,colors:new Set(),views:new Set()};products[asset.product].count+=1;products[asset.product].colors.add(asset.color);products[asset.product].views.add(asset.view);}
    res.json({ok:true,mockups:{count:mockups.count||0,products:Object.fromEntries(Object.entries(products).map(([key,value])=>[key,{count:value.count,colors:[...value.colors],views:[...value.views]}]))},premades:{count:premades.count||0,categories:premades.categories||[],restricted:(premades.assets||[]).filter(item=>item.restricted).length},masters:{count:fs.existsSync(path.join(__dirname,'../public/mockup-masters'))?fs.readdirSync(path.join(__dirname,'../public/mockup-masters')).filter(name=>/\.png$/i.test(name)).length:0}});
  });

  router.put('/admin/feature-controls/:actionCode', async (req, res) => {
    const scopeType=req.body.scope_type==='user'?'user':'platform',scopeUserId=scopeType==='user'?Number(req.body.scope_user_id):null;
    if(scopeType==='user'&&(!Number.isInteger(scopeUserId)||scopeUserId<1))return res.status(400).json({ok:false,error:'scope_user_required'});
    const [found]=await db().execute('SELECT action_code FROM action_catalog WHERE action_code=? LIMIT 1',[req.params.actionCode]);
    if(!found[0])return res.status(404).json({ok:false,error:'action_not_found'});
    const [[previous]]=await db().execute(`SELECT enabled,reason,effective_from,effective_until FROM feature_control_overrides WHERE entity_type='action' AND entity_key=? AND scope_type=? AND scope_user_id <=> ? LIMIT 1`,[req.params.actionCode,scopeType,scopeUserId]);
    const next={enabled:req.body.enabled!==false,reason:req.body.reason||null,effective_from:req.body.effective_from||null,effective_until:req.body.effective_until||null};
    await db().execute(`INSERT INTO feature_control_overrides(entity_type,entity_key,scope_type,scope_user_id,enabled,reason,effective_from,effective_until,updated_by_user_id) VALUES('action',?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),reason=VALUES(reason),effective_from=VALUES(effective_from),effective_until=VALUES(effective_until),updated_by_user_id=VALUES(updated_by_user_id)`,[req.params.actionCode,scopeType,scopeUserId,next.enabled?1:0,String(next.reason||'').slice(0,500)||null,next.effective_from,next.effective_until,req.user.id]);
    await db().execute(`INSERT INTO feature_control_events(actor_user_id,entity_type,entity_key,scope_type,scope_user_id,event_type,previous_json,next_json) VALUES(?,'action',?,?,?,'visibility_changed',?,?)`,[req.user.id,req.params.actionCode,scopeType,scopeUserId,JSON.stringify(previous||null),JSON.stringify(next)]);
    res.json({ok:true,action_code:req.params.actionCode,scope_type:scopeType,scope_user_id:scopeUserId,...next});
  });

  router.put('/admin/price-controls/:actionCode', async (req, res) => {
    const scopeType=req.body.scope_type==='user'?'user':'platform',scopeUserId=scopeType==='user'?Number(req.body.scope_user_id):null,value=req.body.override_base_credits;
    if(scopeType==='user'&&(!Number.isInteger(scopeUserId)||scopeUserId<1))return res.status(400).json({ok:false,error:'scope_user_required'});
    if(value!==null&&value!==''&&(!Number.isInteger(Number(value))||Number(value)<0))return res.status(400).json({ok:false,error:'invalid_credit_price'});
    const [[action]]=await db().execute('SELECT action_code,base_credits FROM action_catalog WHERE action_code=? LIMIT 1',[req.params.actionCode]);
    if(!action)return res.status(404).json({ok:false,error:'action_not_found'});
    const [[previous]]=await db().execute(`SELECT override_base_credits,reason,effective_from,effective_until FROM action_price_overrides WHERE action_code=? AND scope_type=? AND scope_user_id <=> ? LIMIT 1`,[req.params.actionCode,scopeType,scopeUserId]);
    const override=value===null||value===''?null:Number(value),next={override_base_credits:override,reason:req.body.reason||null,effective_from:req.body.effective_from||null,effective_until:req.body.effective_until||null,original_base_credits:Number(action.base_credits)};
    await db().execute(`INSERT INTO action_price_overrides(action_code,scope_type,scope_user_id,override_base_credits,reason,effective_from,effective_until,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE override_base_credits=VALUES(override_base_credits),reason=VALUES(reason),effective_from=VALUES(effective_from),effective_until=VALUES(effective_until),updated_by_user_id=VALUES(updated_by_user_id)`,[req.params.actionCode,scopeType,scopeUserId,override,String(next.reason||'').slice(0,500)||null,next.effective_from,next.effective_until,req.user.id]);
    await db().execute(`INSERT INTO feature_control_events(actor_user_id,entity_type,entity_key,scope_type,scope_user_id,event_type,previous_json,next_json) VALUES(?,'action',?,?,?,'price_changed',?,?)`,[req.user.id,req.params.actionCode,scopeType,scopeUserId,JSON.stringify(previous||null),JSON.stringify(next)]);
    res.json({ok:true,action_code:req.params.actionCode,scope_type:scopeType,scope_user_id:scopeUserId,...next});
  });

  router.post('/catalog/:actionCode/estimate', async (req, res) => {
    const action = await actionCatalog.getAction(db(), req.params.actionCode,req.user.id);
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

  router.get('/approvals', async (req, res) => {
    const [approvals]=await db().query(`SELECT a.approval_key,a.authority_class,a.status,a.expires_at,a.created_at,m.mission_key,m.title FROM swarm_approvals a JOIN swarm_missions m ON m.id=a.mission_id WHERE a.status='pending' ORDER BY a.created_at DESC LIMIT 200`);
    res.json({ok:true,approvals});
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
  const [owners] = await db().execute(
    `SELECT ti.owner_user_id id,u.role
     FROM tenant_identities ti JOIN accounts a ON a.id=ti.account_id
     JOIN users u ON u.id=ti.owner_user_id AND u.status='active'
     WHERE a.account_key='madedeck' AND a.status='active' LIMIT 1`
  );
  const owner = owners[0];
  if (!owner || owner.role !== 'platform_admin') return { configured: false, granted: false };
  await db().execute(
    `INSERT INTO user_entitlements(user_id,entitlement_key,enabled,granted_by_user_id)
     VALUES(?,?,1,?) ON DUPLICATE KEY UPDATE enabled=1,expires_at=NULL,granted_by_user_id=VALUES(granted_by_user_id)`,
    [owner.id, POWER_ENTITLEMENT, owner.id]
  );
  return { configured: true, granted: true };
}

module.exports = { createSwarmPowerRouter, ensureVinnyEntitlement };
