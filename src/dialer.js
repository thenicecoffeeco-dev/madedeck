const crypto=require('crypto');
const express=require('express');
const path=require('path');

const DISPOSITIONS={
  APPT_SET:['Appointment Set','WIN',0],QUALIFIED:['Qualified Lead','WIN',30],CALLBACK:['Callback Scheduled','WARM',0],INTERESTED:['Interested / Send Info','WARM',7],NEEDS_THINKING:['Needs to Think','WARM',14],
  NOT_INTERESTED:['Not Interested','OBJECTION',90],HAS_PROVIDER:['Already Has Someone','OBJECTION',180],TOO_EXPENSIVE:['Too Expensive','OBJECTION',60],CALL_BACK_LATER:['Call Back Later','OBJECTION',7],SEND_EMAIL:['Send Email Instead','OBJECTION',3],NO_DECISION:['Not Decision Maker','OBJECTION',30],NOT_QUALIFIED:['Not Qualified','OBJECTION',180],
  NO_ANSWER:['No Answer','NO_CONTACT',1],BUSY:['Busy Signal','NO_CONTACT',1],VOICEMAIL:['Left Voicemail','NO_CONTACT',3],ANSWERING_MACHINE:['Answering Machine','NO_CONTACT',3],AI_GATEKEEPER:['AI / Robot','NO_CONTACT',7],
  BAD_NUMBER:['Bad / Disconnected','TERMINAL',-1],WRONG_NUMBER:['Wrong Number','TERMINAL',-1],DO_NOT_CALL:['Do Not Call / Opt-Out','TERMINAL',-1],HUNG_UP:['Hung Up','TERMINAL',30],HOSTILE:['Hostile / Abusive','TERMINAL',-1],SKIPPED:['Skipped','INTERNAL',0]
};

function normalizePhone(value){
  const raw=String(value||'').trim(); const digits=raw.replace(/\D/g,'');
  if(!digits)return null;
  if(raw.startsWith('+'))return `+${digits}`;
  if(digits.length===10)return `+1${digits}`;
  if(digits.length===11&&digits.startsWith('1'))return `+${digits}`;
  return `+${digits}`;
}

function createDialerRouter({db,session}){
  const router=express.Router();
  async function requireOperator(req,res,next){
    const current=await session(req); if(!current)return res.status(401).json({ok:false,error:'login_required'});
    req.user=current; next();
  }
  router.use(requireOperator);
  router.get('/ui',(req,res)=>res.sendFile(path.join(__dirname,'../private/dialer-console.html')));

  router.get('/context',async(req,res)=>{
    const [[account]]=await db().execute(`SELECT a.subscription_status,a.calls_used,a.usage_period_end,a.default_provider_key,p.plan_code,p.name,p.monthly_price_cents,p.included_calls,p.feature_json FROM dialer_accounts a LEFT JOIN dialer_plans p ON p.plan_code=a.plan_code WHERE a.user_id=? LIMIT 1`,[req.user.id]);
    const [providers]=await db().execute(`SELECT provider_key,display_name,connection_mode,status,from_number_hint,last_verified_at FROM dialer_provider_connections WHERE user_id=? ORDER BY display_name`,[req.user.id]);
    res.json({ok:true,account:account||{subscription_status:'inactive',calls_used:0},providers,dispositions:Object.entries(DISPOSITIONS).map(([code,[label,category,cooldown_days]])=>({code,label,category,cooldown_days}))});
  });

  router.get('/queue',async(req,res)=>{
    const limit=Math.min(200,Math.max(1,Number(req.query.limit||75)));
    const [leads]=await db().execute(`SELECT l.id,l.company,l.contact_name,l.phone_e164,l.email,l.industry,l.lifecycle_stage,l.qualification_score,l.qualification_lane,l.last_contacted_at,l.next_action_at,
      CASE WHEN EXISTS(SELECT 1 FROM dialer_suppressions s WHERE s.user_id=l.owner_user_id AND s.phone_e164=l.phone_e164 AND (s.expires_at IS NULL OR s.expires_at>NOW())) THEN 1 ELSE 0 END suppressed
      FROM crm_leads l WHERE l.owner_user_id=? AND l.phone_e164 IS NOT NULL ORDER BY suppressed ASC,l.next_action_at IS NULL DESC,l.next_action_at ASC,l.qualification_score DESC LIMIT ?`,[req.user.id,limit]);
    res.json({ok:true,leads});
  });

  router.get('/leads/:leadId',async(req,res)=>{
    const [[lead]]=await db().execute(`SELECT id,company,contact_name,phone_e164,email,website,industry,postal_code,lifecycle_stage,qualification_score,qualification_lane,source,consent_status,custom_fields_json,last_contacted_at,next_action_at,created_at,updated_at FROM crm_leads WHERE id=? AND owner_user_id=? LIMIT 1`,[Number(req.params.leadId),req.user.id]);
    if(!lead)return res.status(404).json({ok:false,error:'lead_not_found'});
    const [calls]=await db().execute(`SELECT call_key,provider_key,state,disposition_code,disposition_category,talk_seconds,notes,created_at,completed_at FROM dialer_calls WHERE lead_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50`,[lead.id,req.user.id]);
    const [callbacks]=await db().execute(`SELECT scheduled_for,status,note FROM dialer_callbacks WHERE lead_id=? AND user_id=? ORDER BY scheduled_for DESC LIMIT 20`,[lead.id,req.user.id]);
    res.json({ok:true,lead,calls,callbacks});
  });

  router.post('/leads/import',async(req,res)=>{
    const rows=Array.isArray(req.body.rows)?req.body.rows:[]; if(!rows.length||rows.length>5000)return res.status(400).json({ok:false,error:'rows_required_or_limit_exceeded'});
    let imported=0,skipped=0;
    for(const row of rows){
      const phone=normalizePhone(row.phone||row.phone_e164); if(!phone){skipped++;continue;}
      const external=String(row.external_key||crypto.randomUUID()).slice(0,190);
      await db().execute(`INSERT INTO crm_leads(owner_user_id,external_key,company,contact_name,phone_e164,email,website,industry,postal_code,source,custom_fields_json)
        VALUES(?,?,?,?,?,?,?,?,?,'dialer_import',?) ON DUPLICATE KEY UPDATE company=VALUES(company),contact_name=VALUES(contact_name),phone_e164=VALUES(phone_e164),email=VALUES(email),website=VALUES(website),industry=VALUES(industry),postal_code=VALUES(postal_code),custom_fields_json=VALUES(custom_fields_json)`,
      [req.user.id,external,String(row.company||'').slice(0,190),String(row.contact_name||row.contact||'').slice(0,190),phone,String(row.email||'').slice(0,254)||null,String(row.website||'').slice(0,500)||null,String(row.industry||'').slice(0,120)||null,String(row.postal_code||row.zip||'').slice(0,24)||null,JSON.stringify(row)]); imported++;
    }
    res.status(201).json({ok:true,imported,skipped,next:'run_lead_digester_or_open_queue'});
  });

  router.post('/sessions',async(req,res)=>{
    const key=crypto.randomUUID(),source=['crm','csv','swarm_segment','manual'].includes(req.body.source_type)?req.body.source_type:'crm';
    await db().execute(`INSERT INTO dialer_sessions(session_key,user_id,source_type,source_reference,queue_filter_json) VALUES(?,?,?,?,?)`,[key,req.user.id,source,String(req.body.source_reference||'').slice(0,190)||null,JSON.stringify(req.body.filters||{})]);
    res.status(201).json({ok:true,session_key:key,state:'open'});
  });

  router.post('/calls/prepare',async(req,res)=>{
    const [[account]]=await db().execute(`SELECT a.id,a.subscription_status,a.calls_used,p.included_calls FROM dialer_accounts a JOIN dialer_plans p ON p.plan_code=a.plan_code WHERE a.user_id=? LIMIT 1`,[req.user.id]);
    if(!account||!['active','trialing'].includes(account.subscription_status))return res.status(402).json({ok:false,error:'dialer_subscription_required'});
    if(Number(account.calls_used)>=Number(account.included_calls))return res.status(402).json({ok:false,error:'monthly_call_limit_reached'});
    const [[lead]]=await db().execute(`SELECT id,phone_e164,consent_status FROM crm_leads WHERE id=? AND owner_user_id=? LIMIT 1`,[Number(req.body.lead_id),req.user.id]);
    if(!lead)return res.status(404).json({ok:false,error:'lead_not_found'});
    const [[suppression]]=await db().execute(`SELECT reason_code,scope,expires_at FROM dialer_suppressions WHERE user_id=? AND phone_e164=? AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1`,[req.user.id,lead.phone_e164]);
    if(suppression)return res.status(409).json({ok:false,error:'lead_suppressed',suppression});
    const provider=String(req.body.provider_key||'').trim();
    const [[connection]]=await db().execute(`SELECT provider_key,connection_mode,status FROM dialer_provider_connections WHERE user_id=? AND provider_key=? LIMIT 1`,[req.user.id,provider]);
    if(!connection||!['configured','connected'].includes(connection.status))return res.status(409).json({ok:false,error:'provider_not_ready'});
    const key=crypto.randomUUID();
    await db().execute(`INSERT INTO dialer_calls(call_key,user_id,lead_id,provider_key,state,provider_payload_json) VALUES(?,?,?,?,'prepared',?)`,[key,req.user.id,lead.id,provider,JSON.stringify({connection_mode:connection.connection_mode})]);
    res.status(201).json({ok:true,call_key:key,phone:lead.phone_e164,provider,connection_mode:connection.connection_mode,launch_authorized:false,next:connection.connection_mode==='api'?'provider_adapter_required':'operator_handoff'});
  });

  router.post('/calls/:callKey/disposition',async(req,res)=>{
    const meta=DISPOSITIONS[String(req.body.disposition_code||'')]; if(!meta)return res.status(400).json({ok:false,error:'invalid_disposition'});
    const [rows]=await db().execute(`SELECT id,lead_id,state,started_at FROM dialer_calls WHERE call_key=? AND user_id=? LIMIT 1`,[req.params.callKey,req.user.id]); const call=rows[0];
    if(!call)return res.status(404).json({ok:false,error:'call_not_found'});
    const [label,category,days]=meta; const notes=String(req.body.notes||'').slice(0,10000); const talk=Math.max(0,Number(req.body.talk_seconds||0));
    await db().execute(`UPDATE dialer_calls SET state='completed',disposition_code=?,disposition_category=?,talk_seconds=?,notes=?,completed_at=NOW() WHERE id=?`,[req.body.disposition_code,category,talk,notes,call.id]);
    await db().execute(`UPDATE crm_leads SET lifecycle_stage=?,last_contacted_at=NOW(),next_action_at=? WHERE id=?`,[category==='WIN'?'qualified':category==='TERMINAL'?'closed':'follow_up',req.body.callback_at||null,call.lead_id]);
    if(days!==0){
      const [[lead]]=await db().execute('SELECT phone_e164 FROM crm_leads WHERE id=?',[call.lead_id]);
      await db().execute(`INSERT INTO dialer_suppressions(user_id,phone_e164,scope,reason_code,reason_text,expires_at,source_call_id,created_by_user_id) VALUES(?,?,?, ?,?,?,?,?) ON DUPLICATE KEY UPDATE reason_text=VALUES(reason_text),expires_at=VALUES(expires_at),source_call_id=VALUES(source_call_id)`,[req.user.id,lead.phone_e164,days<0?'permanent':'cooldown',req.body.disposition_code,label,days<0?null:new Date(Date.now()+days*86400000),call.id,req.user.id]);
    }
    if(req.body.disposition_code==='CALLBACK'&&req.body.callback_at)await db().execute(`INSERT INTO dialer_callbacks(user_id,lead_id,call_id,scheduled_for,note) VALUES(?,?,?,?,?)`,[req.user.id,call.lead_id,call.id,req.body.callback_at,notes.slice(0,1000)]);
    await db().execute('UPDATE dialer_accounts SET calls_used=calls_used+1 WHERE user_id=?',[req.user.id]);
    res.json({ok:true,call_key:req.params.callKey,disposition:{code:req.body.disposition_code,label,category,cooldown_days:days}});
  });

  router.get('/kpis',async(req,res)=>{
    const days=Math.min(365,Math.max(1,Number(req.query.days||30)));
    const [[summary]]=await db().execute(`SELECT COUNT(*) total_calls,SUM(disposition_category IN ('WIN','WARM','OBJECTION')) connected,SUM(disposition_code='APPT_SET') appointments,SUM(disposition_code='QUALIFIED') qualified,SUM(disposition_code='CALLBACK') callbacks,SUM(disposition_code IN ('BAD_NUMBER','WRONG_NUMBER')) bad_numbers,SUM(disposition_code IN ('VOICEMAIL','ANSWERING_MACHINE')) voicemails,SUM(disposition_code='AI_GATEKEEPER') ai_detected,SUM(disposition_code='DO_NOT_CALL') opt_outs,COALESCE(SUM(talk_seconds),0) talk_seconds,COALESCE(SUM(provider_cost_minor),0) provider_cost_minor FROM dialer_calls WHERE user_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)`,[req.user.id,days]);
    const total=Number(summary.total_calls||0),connected=Number(summary.connected||0);
    res.json({ok:true,days,summary:{...summary,total_calls:total,connected,connect_rate:total?Number((connected*100/total).toFixed(1)):0,appointment_rate:total?Number((Number(summary.appointments||0)*100/total).toFixed(1)):0,avg_talk_seconds:connected?Math.round(Number(summary.talk_seconds||0)/connected):0}});
  });
  return router;
}

module.exports={createDialerRouter,DISPOSITIONS,normalizePhone};
