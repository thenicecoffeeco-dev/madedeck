'use strict';

const crypto=require('crypto');
const express=require('express');

const PURPOSES=new Set(['owner_alerts','orders','billing','support','marketing','recovery']);
const ROLES=new Set(['super','operator','merchant','partner']);
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value){return String(value||'').trim().toLowerCase()}
function hash(value){return crypto.createHash('sha256').update(String(value)).digest('hex')}
function fail(status,code,message){const e=new Error(message);e.status=status;e.code=code;throw e}

function createEmailHooksRouter({db,session}){
  const router=express.Router();

  async function authorize(req,res,next){
    try{
      const current=await session(req);
      if(!current)return res.status(401).json({ok:false,error:'login_required'});
      if(!ROLES.has(current.acting_role)&&current.role!=='platform_admin')return res.status(403).json({ok:false,error:'email_settings_forbidden'});
      req.user=current;next();
    }catch(error){next(error)}
  }

  function scope(req){
    return {accountId:Number(req.user.account_id),storeId:req.user.store_id==null?null:Number(req.user.store_id)};
  }

  router.get('/settings',authorize,async(req,res,next)=>{
    try{
      const s=scope(req);
      const [rows]=await db().execute(
        `SELECT endpoint_ref,purpose,email,status,is_primary,verified_at,created_at,updated_at
         FROM account_email_endpoints WHERE account_id=? AND (store_id<=>?) ORDER BY purpose,is_primary DESC,created_at`,
        [s.accountId,s.storeId]
      );
      res.set('Cache-Control','no-store').json({ok:true,identity:{user_id:req.user.id,account_id:s.accountId,store_id:s.storeId,ownership_source:'account_membership'},endpoints:rows});
    }catch(error){next(error)}
  });

  router.post('/settings',authorize,async(req,res,next)=>{
    try{
      const s=scope(req),purpose=String(req.body?.purpose||''),email=cleanEmail(req.body?.email);
      if(!PURPOSES.has(purpose))fail(400,'invalid_email_purpose','Choose a supported email purpose');
      if(!emailPattern.test(email)||email.length>254)fail(400,'invalid_email','Enter a valid email address');
      const endpointRef=crypto.randomUUID(),rawToken=crypto.randomBytes(32).toString('hex');
      const connection=await db().getConnection();
      try{
        await connection.beginTransaction();
        const [created]=await connection.execute(
          `INSERT INTO account_email_endpoints(endpoint_ref,account_id,store_id,purpose,email,status,is_primary,created_by_user_id,updated_by_user_id)
           VALUES(?,?,?,?,?,'pending',0,?,?) ON DUPLICATE KEY UPDATE endpoint_ref=VALUES(endpoint_ref),status='pending',verified_at=NULL,updated_by_user_id=VALUES(updated_by_user_id)`,
          [endpointRef,s.accountId,s.storeId,purpose,email,req.user.id,req.user.id]
        );
        const [[endpoint]]=await connection.execute(
          'SELECT id,endpoint_ref FROM account_email_endpoints WHERE account_id=? AND (store_id<=>?) AND purpose=? AND email=? LIMIT 1',
          [s.accountId,s.storeId,purpose,email]
        );
        await connection.execute('DELETE FROM email_verification_tokens WHERE endpoint_id=?',[endpoint.id]);
        await connection.execute(
          `INSERT INTO email_verification_tokens(endpoint_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))`,
          [endpoint.id,hash(rawToken)]
        );
        await connection.execute(
          `INSERT INTO email_delivery_outbox(message_ref,account_id,store_id,purpose,template_key,recipient_endpoint_id,payload_json,idempotency_key)
           VALUES(?,?,?,?,?,?,?,?)`,
          [crypto.randomUUID(),s.accountId,s.storeId,purpose,'verify-email-endpoint',endpoint.id,JSON.stringify({endpoint_ref:endpoint.endpoint_ref,verification_token:rawToken}),`verify:${endpoint.endpoint_ref}`]
        );
        await connection.commit();
        res.status(202).json({ok:true,endpoint_ref:endpoint.endpoint_ref,status:'pending',message:'Verification queued. Login identity and account ownership were not changed.'});
      }catch(error){await connection.rollback();throw error}finally{connection.release()}
    }catch(error){next(error)}
  });

  router.post('/verify',async(req,res,next)=>{
    try{
      const token=String(req.body?.token||'');
      if(token.length<32)fail(400,'invalid_verification_token','The verification token is invalid');
      const connection=await db().getConnection();
      try{
        await connection.beginTransaction();
        const [rows]=await connection.execute(
          `SELECT t.id token_id,t.endpoint_id,e.account_id,e.store_id,e.purpose
           FROM email_verification_tokens t JOIN account_email_endpoints e ON e.id=t.endpoint_id
           WHERE t.token_hash=? AND t.consumed_at IS NULL AND t.expires_at>UTC_TIMESTAMP() FOR UPDATE`,
          [hash(token)]
        );
        const row=rows[0];if(!row)fail(400,'expired_verification_token','The verification token is invalid or expired');
        await connection.execute('UPDATE email_verification_tokens SET consumed_at=UTC_TIMESTAMP() WHERE id=?',[row.token_id]);
        await connection.execute('UPDATE account_email_endpoints SET status=\'verified\',verified_at=UTC_TIMESTAMP() WHERE id=?',[row.endpoint_id]);
        await connection.execute(
          `UPDATE account_email_endpoints SET is_primary=0 WHERE account_id=? AND (store_id<=>?) AND purpose=? AND id<>?`,
          [row.account_id,row.store_id,row.purpose,row.endpoint_id]
        );
        await connection.execute('UPDATE account_email_endpoints SET is_primary=1 WHERE id=?',[row.endpoint_id]);
        await connection.commit();
        res.json({ok:true,status:'verified'});
      }catch(error){await connection.rollback();throw error}finally{connection.release()}
    }catch(error){next(error)}
  });

  router.post('/queue',authorize,async(req,res,next)=>{
    try{
      const s=scope(req),purpose=String(req.body?.purpose||''),template=String(req.body?.template_key||'').trim();
      const idempotency=String(req.get('Idempotency-Key')||'').trim();
      if(!PURPOSES.has(purpose)||!template)fail(400,'invalid_email_job','Purpose and template_key are required');
      if(idempotency.length<8||idempotency.length>190)fail(400,'idempotency_required','A valid Idempotency-Key is required');
      const [[endpoint]]=await db().execute(
        `SELECT id FROM account_email_endpoints WHERE account_id=? AND (store_id<=>?) AND purpose=? AND status='verified' ORDER BY is_primary DESC,verified_at DESC LIMIT 1`,
        [s.accountId,s.storeId,purpose]
      );
      if(!endpoint)fail(409,'verified_route_required','No verified email route exists for this purpose');
      const messageRef=crypto.randomUUID();
      await db().execute(
        `INSERT INTO email_delivery_outbox(message_ref,account_id,store_id,purpose,template_key,recipient_endpoint_id,payload_json,idempotency_key)
         VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE message_ref=message_ref`,
        [messageRef,s.accountId,s.storeId,purpose,template,endpoint.id,JSON.stringify(req.body?.payload||{}),idempotency]
      );
      const [[job]]=await db().execute('SELECT message_ref,status FROM email_delivery_outbox WHERE account_id=? AND idempotency_key=?',[s.accountId,idempotency]);
      res.status(job.message_ref===messageRef?201:200).json({ok:true,job});
    }catch(error){next(error)}
  });

  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);console.error('email hooks error',error.code||error.message);res.status(error.status||500).json({ok:false,error:error.code||'email_hooks_error'})});
  return router;
}

module.exports={createEmailHooksRouter,PURPOSES};
