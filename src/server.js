const express=require('express');
const path=require('path');
const fs=require('fs');
const cookieParser=require('cookie-parser');
const crypto=require('crypto');
const {db,verifyPassword,seedUser}=require('./db');
const {MONETIZATION_CATALOG,ROLE_PERMISSIONS,ORDER_TRANSITIONS,requirePermission,paymentCapabilities,vendorSettlementPolicy}=require('./platform-engine');
const app=express();
const publicDir=path.join(__dirname,'../public');
const APP_VERSION='0.6.0';
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:false}));
app.use(cookieParser());
app.get('/',(req,res)=>{
  try{
    const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8')
      .replace('href="/styles.css"',`href="/styles.css?v=${APP_VERSION}"`)
      .replace('src="/app.js"',`src="/app.js?v=${APP_VERSION}"`)
      .replace('</body>',`<script src="/cart-v05.js?v=${APP_VERSION}"></script></body>`);
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma','no-cache');
    res.set('Expires','0');
    res.type('html').send(html);
  }catch(e){res.status(500).send('MadeDeck frontend unavailable');}
});
app.use(express.static(publicDir,{setHeaders:(res,filePath)=>{
  if(filePath.endsWith('.css')||filePath.endsWith('.js')||filePath.endsWith('.html')||filePath.endsWith('.json')){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
  }
}}));

const sessions=new Map();
function session(req){const token=req.cookies.md_session;return token?sessions.get(token):null;}
function requireUser(req,res,next){const s=session(req);if(!s)return res.status(401).json({ok:false,error:'login_required'});req.user=s;next();}
function cartRole(req){const s=session(req);if(!s)return 'customer';if(['platform_admin','super_admin','finance_admin'].includes(s.role))return 'owner';return 'merchant';}
function platformEconomics(subtotal){
  const percent=Math.max(0,Number(process.env.MADEDECK_PLATFORM_FEE_PERCENT||0));
  const fixed=Math.max(0,Number(process.env.MADEDECK_PLATFORM_FEE_FIXED||0));
  const platformFee=Math.max(0,(subtotal*(percent/100))+fixed);
  return {platform_fee:Number(platformFee.toFixed(2)),merchant_payout:Number(Math.max(0,subtotal-platformFee).toFixed(2))};
}
function token(){return crypto.randomBytes(24).toString('hex');}
async function queueNotification(event_key,recipient_type,recipient_ref,subject,payload,channel='email'){
  try{
    await db().execute('INSERT INTO notification_outbox(event_key,recipient_type,recipient_ref,channel,subject,payload_json) VALUES(?,?,?,?,?,?)',[event_key,recipient_type,String(recipient_ref),channel,subject,JSON.stringify(payload)]);
  }catch(e){console.warn('notification queue unavailable:',e.message);}
}

app.get('/health',async(req,res)=>{try{await db().query('SELECT 1');res.json({ok:true,mode:'database',database:'connected',version:APP_VERSION});}catch(e){res.status(503).json({ok:false,database:'disconnected',error:e.message});}});

app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');const [rows]=await db().execute('SELECT id,email,password_salt,password_hash,role,status FROM users WHERE email=? LIMIT 1',[email]);const u=rows[0];if(!u||u.status!=='active'||!verifyPassword(password,u.password_salt,u.password_hash))return res.status(401).json({ok:false,error:'invalid_credentials'});const t=crypto.randomBytes(32).toString('hex');sessions.set(t,{id:u.id,email:u.email,role:u.role});res.cookie('md_session',t,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12});res.json({ok:true,user:{id:u.id,email:u.email,role:u.role}});});
app.post('/api/auth/logout',(req,res)=>{if(req.cookies.md_session)sessions.delete(req.cookies.md_session);res.clearCookie('md_session');res.json({ok:true});});
app.get('/api/me',requireUser,(req,res)=>res.json({ok:true,user:req.user,permissions:ROLE_PERMISSIONS[req.user.role]||[]}));

app.get('/api/cart/context',(req,res)=>res.json({ok:true,role:cartRole(req),providers:paymentCapabilities(),vendor_policy:vendorSettlementPolicy(),version:APP_VERSION}));
app.post('/api/checkout/preview',(req,res)=>{
  const subtotal=Math.max(0,Number(req.body.subtotal||0));
  const shipping=Math.max(0,Number(req.body.shipping||0));
  const provider=String(req.body.provider||'stripe');
  const providers=paymentCapabilities();
  const selected=providers.find(p=>p.key===provider);
  const role=cartRole(req);
  const economics=platformEconomics(subtotal);
  const response={ok:true,role,provider,provider_enabled:!!selected?.configured,totals:{subtotal,shipping,grand:Number((subtotal+shipping).toFixed(2))}};
  if(role!=='customer')response.economics={...economics,vendor_auto_pay:false};
  res.json(response);
});

app.get('/api/platform/monetization',requireUser,(req,res)=>res.json({ok:true,catalog:MONETIZATION_CATALOG,plans:{payg:{activation:1,preorder:6},promo:{first_month:1}},version:APP_VERSION}));
app.get('/api/platform/roles',requireUser,(req,res)=>res.json({ok:true,roles:ROLE_PERMISSIONS}));
app.get('/api/vendor/settlement-policy',requireUser,(req,res)=>res.json({ok:true,policy:vendorSettlementPolicy()}));

app.get('/api/offers',requireUser,async(req,res)=>{const [rows]=await db().query('SELECT * FROM offers ORDER BY created_at DESC LIMIT 100');res.json({ok:true,offers:rows});});
app.post('/api/offers',requireUser,async(req,res)=>{const b=req.body;const type=['store','preorder','bulk'].includes(b.type)?b.type:'store';const access=['public','paid_customer','private_link'].includes(b.access_mode)?b.access_mode:'public';const fulfillment=['direct','office','both'].includes(b.fulfillment_mode)?b.fulfillment_mode:'both';const price=Number(b.retail_price),min=Number(b.minimum_qty||1);if(!b.store_id||!b.title||!Number.isFinite(price)||price<0)return res.status(400).json({ok:false,error:'invalid_offer'});const [r]=await db().execute('INSERT INTO offers(store_id,product_id,type,title,status,access_mode,fulfillment_mode,retail_price,minimum_qty,closes_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[b.store_id,b.product_id||null,type,b.title,'draft',access,fulfillment,price,Math.max(1,min),b.closes_at||null]);res.status(201).json({ok:true,id:r.insertId});});

app.post('/api/preorders',requireUser,async(req,res)=>{
  const b=req.body||{};const title=String(b.title||'').trim();const description=String(b.description||'').trim().slice(0,180);const storeId=Number(b.store_id||1);const setupFee=Number.isFinite(Number(b.setup_fee))?Number(b.setup_fee):6;const managed=!!b.managed_service;const publicToken=token();
  if(!title)return res.status(400).json({ok:false,error:'title_required'});
  const [r]=await db().execute('INSERT INTO preorder_campaigns(store_id,product_id,title,description,status,minimum_qty,retail_price,closes_at,public_token,setup_fee,managed_service,managed_service_fee,target_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[storeId,b.product_id||null,title,description,'draft',Math.max(1,Number(b.minimum_qty||1)),Number(b.retail_price||0),b.closes_at||null,publicToken,setupFee,managed,Number(b.managed_service_fee||0),b.target_amount||null]);
  res.status(201).json({ok:true,id:r.insertId,public_token:publicToken,share_path:`/p/${publicToken}`,setup_fee:setupFee});
});

app.post('/api/direct-pay',requireUser,async(req,res)=>{
  const b=req.body||{};const title=String(b.title||'').trim();const description=String(b.description||'').trim().slice(0,180);const storeId=Number(b.store_id||1);if(!title)return res.status(400).json({ok:false,error:'title_required'});const publicToken=token();
  const [r]=await db().execute('INSERT INTO direct_pay_campaigns(store_id,creator_user_id,title,description,hero_asset_url,public_token,status,target_amount,platform_fee_percent,platform_fee_fixed,closes_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[storeId,req.user.id,title,description,b.hero_asset_url||null,publicToken,'draft',b.target_amount||null,Number(b.platform_fee_percent||0),Number(b.platform_fee_fixed||0),b.closes_at||null]);
  res.status(201).json({ok:true,id:r.insertId,public_token:publicToken,share_path:`/pay/${publicToken}`});
});

app.post('/api/orders/:id/production-notify',requireUser,async(req,res)=>{
  const orderId=Number(req.params.id);if(!orderId)return res.status(400).json({ok:false,error:'invalid_order'});
  const [orders]=await db().execute('SELECT id,store_id,total,status FROM orders WHERE id=? LIMIT 1',[orderId]);const order=orders[0];if(!order)return res.status(404).json({ok:false,error:'order_not_found'});
  const [jobs]=await db().execute('SELECT vj.id,vj.vendor_id,vp.email,vp.name FROM vendor_jobs vj JOIN vendor_profiles vp ON vp.id=vj.vendor_id WHERE vj.order_id=?',[orderId]);
  await queueNotification('order.production_ready','owner',process.env.OWNER_NOTIFICATION_EMAIL||'owner','New MadeDeck order ready for production',{order_id:orderId,total:order.total,status:order.status});
  for(const job of jobs){if(job.email)await queueNotification('vendor.job_assigned','vendor',job.email,'New MadeDeck production job',{order_id:orderId,vendor_job_id:job.id,vendor_name:job.name});await db().execute("UPDATE vendor_jobs SET status='notified',notified_at=NOW() WHERE id=?",[job.id]);}
  res.json({ok:true,owner_notified:true,vendors_notified:jobs.length,auto_pay_vendor:false});
});

app.get('/api/vendor/jobs',requireUser,async(req,res)=>{
  if(!['production_vendor','platform_staff','platform_admin','super_admin'].includes(req.user.role))return res.status(403).json({ok:false,error:'forbidden'});
  const [rows]=await db().query('SELECT vj.*,vp.name AS vendor_name FROM vendor_jobs vj JOIN vendor_profiles vp ON vp.id=vj.vendor_id ORDER BY vj.created_at DESC LIMIT 100');
  res.json({ok:true,jobs:rows,auto_pay_vendor:false});
});

app.post('/api/vendor/payables/:id/approve',requireUser,requirePermission('vendor_payable_approve'),async(req,res)=>{
  const id=Number(req.params.id);await db().execute("UPDATE vendor_payables SET status='approved',approved_by=?,approved_at=NOW() WHERE id=? AND status='pending'",[req.user.id,id]);await db().execute("INSERT INTO vendor_settlement_events(vendor_payable_id,event_type,actor_user_id,notes) VALUES(?,'approved',?,?)",[id,req.user.id,String(req.body.notes||'')]);res.json({ok:true,id,status:'approved',auto_paid:false});
});
app.post('/api/vendor/payables/:id/mark-paid',requireUser,requirePermission('vendor_payable_mark_paid'),async(req,res)=>{
  const id=Number(req.params.id);const method=String(req.body.payment_method||'manual');const ref=String(req.body.payment_reference||'');await db().execute("UPDATE vendor_payables SET status='paid',payment_method=?,payment_reference=?,paid_by=?,paid_at=NOW() WHERE id=? AND status='approved'",[method,ref,req.user.id,id]);await db().execute("INSERT INTO vendor_settlement_events(vendor_payable_id,event_type,actor_user_id,reference_value,notes) VALUES(?,'marked_paid',?,?,?)",[id,req.user.id,ref,String(req.body.notes||'')]);res.json({ok:true,id,status:'paid',manual_settlement:true});
});

app.post('/api/orders/:id/transition',requireUser,async(req,res)=>{
  const id=Number(req.params.id),to=String(req.body.to||'');const [rows]=await db().execute('SELECT status FROM orders WHERE id=? LIMIT 1',[id]);const order=rows[0];if(!order)return res.status(404).json({ok:false,error:'order_not_found'});const allowed=ORDER_TRANSITIONS[order.status]||[];if(!allowed.includes(to))return res.status(409).json({ok:false,error:'invalid_transition',from:order.status,to,allowed});await db().execute('UPDATE orders SET status=? WHERE id=?',[to,id]);try{await db().execute('INSERT INTO order_state_events(order_id,from_state,to_state,actor_type,actor_ref,reason) VALUES(?,?,?,?,?,?)',[id,order.status,to,req.user.role,String(req.user.id),String(req.body.reason||'')]);}catch{}res.json({ok:true,id,from:order.status,to});
});

app.get('/api/platform/features',requireUser,async(req,res)=>{if(!['platform_admin','super_admin'].includes(req.user.role))return res.status(403).json({ok:false,error:'forbidden'});const [rows]=await db().query('SELECT * FROM feature_flags ORDER BY feature_key');res.json({ok:true,features:rows});});

async function boot(){
  await db().query('SELECT 1');
  await seedUser(process.env.SEED_ADMIN_EMAIL,process.env.SEED_ADMIN_PASSWORD,'platform_admin');
  await seedUser(process.env.SEED_MERCHANT_EMAIL,process.env.SEED_MERCHANT_PASSWORD,'merchant_admin');
  const [merchantRows]=await db().execute('SELECT id FROM users WHERE email=? LIMIT 1',[String(process.env.SEED_MERCHANT_EMAIL||'').toLowerCase()]);
  const merchant=merchantRows[0];
  if(merchant){
    await db().execute('UPDATE stores SET owner_user_id=? WHERE id=1',[merchant.id]);
    await db().execute("INSERT INTO store_members(store_id,user_id,member_role) VALUES(1,?,'owner') ON DUPLICATE KEY UPDATE member_role='owner'",[merchant.id]);
  }
  const port=Number(process.env.PORT||3000);
  app.listen(port,()=>console.log(`MadeDeck listening on ${port}`));
}
boot().catch(e=>{console.error(e);process.exit(1);});
