'use strict';

const crypto = require('crypto');
const express = require('express');

const ROLE_KEYS = new Set(['super','operator','partner','merchant','customer','subscriber','creator','staff','guest']);
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const canonical = prefix => `${prefix}-${crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase()}`;
const stableJson = value => JSON.stringify(value, Object.keys(value || {}).sort());
const parseJson = value => { if(value==null)return null;if(typeof value!=='string')return value;try{return JSON.parse(value)}catch{return null} };

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function parseBearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}
function parseCookie(req,name){const raw=req.headers.cookie||'';for(const part of raw.split(';')){const [key,...rest]=part.trim().split('=');if(key===name)return decodeURIComponent(rest.join('='))}return null}

function createConnectionBackbone({ db, cookieName='md_session', production=true }) {
  if (!db || typeof db.execute !== 'function' || typeof db.getConnection !== 'function') {
    throw new TypeError('A mysql2-compatible promise pool is required');
  }

  const router = express.Router();
  router.use(express.json({ limit:'2mb' }));

  async function requireSession(req, res, next) {
    try {
      const raw = req.cookies?.[cookieName] || parseCookie(req,cookieName) || parseBearer(req);
      if (!raw) throw httpError(401, 'SESSION_REQUIRED', 'Sign in is required');
      const [rows] = await db.execute(`
        SELECT s.session_key,s.user_id,s.account_id,s.store_id,s.profile_key,s.acting_role,
               s.permissions_json,s.subscription_json,a.account_key,a.account_type,a.status account_status,
               m.status membership_status
        FROM auth_sessions s
        JOIN accounts a ON a.id=s.account_id
        JOIN account_memberships m ON m.id=s.membership_id AND m.account_id=s.account_id AND m.user_id=s.user_id
        WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP()
        LIMIT 1`, [sha256(raw)]);
      const row = rows[0];
      if (!row || row.account_status!=='active' || row.membership_status!=='active') {
        throw httpError(401, 'SESSION_INVALID', 'The session is expired or unavailable');
      }
      if (!ROLE_KEYS.has(row.acting_role)) throw httpError(403, 'ROLE_INVALID', 'The active role is not supported');
      if (row.acting_role==='super' && row.account_key!=='madedeck') {
        throw httpError(403, 'SUPER_SCOPE_REJECTED', 'Super Control is restricted to the platform account');
      }
      req.mdSession = Object.freeze({
        sessionKey:row.session_key,userId:row.user_id,accountId:row.account_id,accountKey:row.account_key,
        accountType:row.account_type,storeId:row.store_id,profileId:row.profile_key,role:row.acting_role,
        permissions:parseJson(row.permissions_json) || [],subscription:parseJson(row.subscription_json) || null
      });
      db.execute('UPDATE auth_sessions SET last_seen_at=UTC_TIMESTAMP() WHERE session_key=?',[row.session_key]).catch(()=>{});
      next();
    } catch (error) { next(error); }
  }

  function requireRoles(...allowed) {
    return (req,res,next) => allowed.includes(req.mdSession?.role) ? next() : next(httpError(403,'ROLE_FORBIDDEN','This account role cannot perform that action'));
  }

  function sameScope(req, accountId, storeId=null) {
    const s=req.mdSession;
    if (s.role==='super') return s.accountKey==='madedeck';
    if (Number(accountId)!==Number(s.accountId)) return false;
    return storeId==null || s.storeId==null || Number(storeId)===Number(s.storeId);
  }

  async function idempotent(req, res, action) {
    const key=req.get('Idempotency-Key');
    if (!key || key.length<8 || key.length>190) throw httpError(400,'IDEMPOTENCY_REQUIRED','A valid Idempotency-Key header is required');
    const requestHash=sha256(`${req.method}:${req.originalUrl}:${stableJson(req.body)}`),connection=await db.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute('SELECT * FROM idempotency_records WHERE account_id=? AND idempotency_key=? FOR UPDATE',[req.mdSession.accountId,key]);
      if (existing[0]) {
        if (existing[0].request_hash!==requestHash) throw httpError(409,'IDEMPOTENCY_CONFLICT','That key was already used for a different request');
        if (existing[0].status==='completed') { await connection.commit(); return res.status(existing[0].response_code||200).json(existing[0].response_json); }
        throw httpError(409,'ACTION_IN_PROGRESS','The original action is still processing');
      }
      await connection.execute(`INSERT INTO idempotency_records(account_id,idempotency_key,request_hash,status,locked_until,expires_at)
        VALUES(?,?,?,'working',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 MINUTE),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))`,[req.mdSession.accountId,key,requestHash]);
      const result=await action(connection,key);
      await connection.execute(`UPDATE idempotency_records SET status='completed',response_code=?,response_json=?,locked_until=NULL WHERE account_id=? AND idempotency_key=?`,[result.status||200,JSON.stringify(result.body),req.mdSession.accountId,key]);
      await connection.commit();
      return res.status(result.status||200).json(result.body);
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async function queueEvent(connection, session, type, aggregateType, aggregateRef, payload) {
    const eventRef=canonical('EVT');
    await connection.execute(`INSERT INTO event_outbox(event_ref,account_id,store_id,profile_key,event_type,aggregate_type,aggregate_ref,payload_json)
      VALUES(?,?,?,?,?,?,?,?)`,[eventRef,session.accountId,session.storeId,session.profileId,type,aggregateType,aggregateRef,JSON.stringify(payload)]);
    return eventRef;
  }

  router.get('/session', requireSession, (req,res) => res.json({ok:true,session:req.mdSession,authority:'server'}));

  router.get('/catalog/products', requireSession, async (req,res,next) => {
    try {
      const [rows]=await db.execute(`SELECT p.id,p.sku,p.name,p.category,p.base_cost,p.production_method,
        pm.color_key,pm.view_key,pm.asset_url,pm.status mockup_status
        FROM products p LEFT JOIN product_mockups pm ON pm.product_id=p.id AND pm.status='active'
        WHERE p.active=1 ORDER BY p.id,pm.color_key,pm.view_key`);
      const products=new Map();
      for(const row of rows){if(!products.has(row.id))products.set(row.id,{id:row.id,sku:row.sku,name:row.name,category:row.category,baseCost:Number(row.base_cost),productionMethod:row.production_method,mockups:[]});if(row.asset_url)products.get(row.id).mockups.push({color:row.color_key,view:row.view_key,url:row.asset_url,status:row.mockup_status})}
      res.json({ok:true,products:[...products.values()],renderer:'canonical-catalog'});
    } catch(error){next(error)}
  });

  router.get('/controls', requireSession, async (req,res,next) => {
    try { const [rows]=await db.execute('SELECT control_key,module_key,label,allowed_roles_json,authority,action_key,destructive,requires_idempotency,enabled FROM control_registry WHERE enabled=1 ORDER BY module_key,control_key');res.json({ok:true,controls:rows.filter(row=>(parseJson(row.allowed_roles_json)||[]).includes(req.mdSession.role)||req.mdSession.role==='super')}) } catch(error){next(error)}
  });

  router.post('/orders', requireSession, (req,res,next) => idempotent(req,res,async connection => {
    const body=req.body||{};
    if(!Array.isArray(body.items)||!body.items.length)throw httpError(422,'ORDER_ITEMS_REQUIRED','At least one product is required');
    if(!sameScope(req,req.mdSession.accountId,body.storeId||req.mdSession.storeId))throw httpError(403,'CROSS_ACCOUNT_REJECTED','The order scope does not belong to this session');
    const snapshot={accountId:req.mdSession.accountId,storeId:req.mdSession.storeId,profileId:req.mdSession.profileId,items:body.items,pricing:body.pricing,shippingAddress:body.shippingAddress,policyVersion:body.policyVersion||'current',capturedAt:new Date().toISOString()};
    const snapshotHash=sha256(JSON.stringify(snapshot)),orderRef=canonical('ORD');
    const [created]=await connection.execute(`INSERT INTO orders(store_id,customer_email,customer_name,status,fulfillment_mode,subtotal,shipping,tax,total)
      VALUES(?,?,?,'pending',?,?,?,?,?)`,[req.mdSession.storeId,body.customerEmail||null,body.customerName||null,body.fulfillmentMode||'direct',Number(body.pricing?.subtotal||0),Number(body.pricing?.shipping||0),Number(body.pricing?.tax||0),Number(body.pricing?.total||0)]);
    const [snap]=await connection.execute(`INSERT INTO order_snapshots(order_id,account_id,pricing_version,snapshot_json,snapshot_hash,locked_at)
      VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,[created.insertId,req.mdSession.accountId,body.pricingVersion||'unversioned',JSON.stringify(snapshot),snapshotHash]);
    const eventRef=await queueEvent(connection,req.mdSession,'order.created','order',String(created.insertId),{orderRef,orderId:created.insertId,snapshotId:snap.insertId});
    return{status:201,body:{ok:true,order:{id:created.insertId,ref:orderRef,status:'pending',snapshotId:snap.insertId,snapshotHash},eventRef}}
  }).catch(next));

  router.post('/orders/:orderId/production-packet', requireSession, requireRoles('super','operator','merchant','partner'), (req,res,next) => idempotent(req,res,async connection => {
    const [orders]=await connection.execute(`SELECT o.id,o.store_id,o.status,s.id snapshot_id,s.account_id,s.snapshot_json,s.snapshot_hash
      FROM orders o JOIN order_snapshots s ON s.order_id=o.id WHERE o.id=? ORDER BY s.snapshot_version DESC LIMIT 1 FOR UPDATE`,[req.params.orderId]);
    const order=orders[0];if(!order)throw httpError(404,'ORDER_NOT_FOUND','Order or immutable snapshot not found');if(!sameScope(req,order.account_id,order.store_id))throw httpError(403,'CROSS_ACCOUNT_REJECTED','The order does not belong to this session');
    const packetRef=canonical('PKT'),manifest={orderId:order.id,orderSnapshotId:order.snapshot_id,orderSnapshotHash:order.snapshot_hash,files:req.body?.files||[],notes:req.body?.notes||null};
    const [packet]=await connection.execute(`INSERT INTO production_packets(packet_ref,account_id,store_id,order_id,order_snapshot_id,status,manifest_json,manifest_hash)
      VALUES(?,?,?,?,?,'prepared',?,?)`,[packetRef,order.account_id,order.store_id,order.id,order.snapshot_id,JSON.stringify(manifest),sha256(JSON.stringify(manifest))]);
    const eventRef=await queueEvent(connection,req.mdSession,'production.packet.prepared','production_packet',packetRef,{packetId:packet.insertId,packetRef,orderId:order.id});
    return{status:201,body:{ok:true,productionPacket:{id:packet.insertId,ref:packetRef,status:'prepared'},eventRef}}
  }).catch(next));

  router.get('/alerts', requireSession, async (req,res,next) => {
    try { const params=[req.mdSession.userId,req.mdSession.storeId];let sql=`SELECT id,user_id,store_id,type,title,body,read_at,created_at FROM notifications WHERE (user_id=? OR user_id IS NULL) AND (store_id=? OR store_id IS NULL)`;if(req.mdSession.role!=='super'&&req.mdSession.role!=='operator')sql+=` AND type NOT LIKE 'admin.%'`;sql+=' ORDER BY created_at DESC LIMIT 100';const [rows]=await db.execute(sql,params);res.json({ok:true,alerts:rows}) } catch(error){next(error)}
  });

  router.get('/reconcile', requireSession, requireRoles('super','operator','merchant','partner'), async (req,res,next) => {
    try { const scopedJoin=req.mdSession.role==='super'?'':'JOIN account_memberships m ON m.store_id=o.store_id AND m.account_id=? AND m.status=\'active\'',params=req.mdSession.role==='super'?[]:[req.mdSession.accountId];const [missingPackets]=await db.execute(`SELECT DISTINCT o.id order_id,o.store_id FROM orders o ${scopedJoin} LEFT JOIN production_packets p ON p.order_id=o.id WHERE o.status IN ('paid','production') AND p.id IS NULL LIMIT 200`,params);const deadSql=req.mdSession.role==='super'?`SELECT id,event_ref,event_type,aggregate_ref,last_error FROM event_outbox WHERE status='dead_letter' ORDER BY created_at DESC LIMIT 200`:`SELECT id,event_ref,event_type,aggregate_ref,last_error FROM event_outbox WHERE account_id=? AND status='dead_letter' ORDER BY created_at DESC LIMIT 200`;const [dead]=await db.execute(deadSql,req.mdSession.role==='super'?[]:[req.mdSession.accountId]);res.json({ok:true,issues:{paidOrdersWithoutProductionPackets:missingPackets,deadLetterEvents:dead}}) } catch(error){next(error)}
  });

  router.get('/health', async (req,res,next) => {try{await db.execute('SELECT 1');res.json({ok:true,mode:'database',database:'connected',backbone:'004',authority:'server',production})}catch(error){next(error)}});

  router.use((error,req,res,next) => {if(res.headersSent)return next(error);res.status(error.status||500).json({ok:false,error:{code:error.code||'INTERNAL_ERROR',message:error.status&&error.status<500?error.message:'The server could not complete the request'}})});
  return { router, requireSession, requireRoles };
}

module.exports = { createConnectionBackbone, ROLE_KEYS };
