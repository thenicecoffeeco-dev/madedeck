const express=require('express');
const path=require('path');
const fs=require('fs');
const cookieParser=require('cookie-parser');
const crypto=require('crypto');
const Stripe=require('stripe');
const {db,verifyPassword,seedUser}=require('./db');
const {createSwarmPowerRouter,ensureVinnyEntitlement}=require('./swarm-power');
const app=express();
const publicDir=path.join(__dirname,'../public');
const APP_VERSION='0.6.0';
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;

function stripeOrderId(obj){
  const raw=obj?.metadata?.madedeck_order_id||obj?.metadata?.order_id||obj?.client_reference_id||null;
  if(raw===null||raw===undefined)return null;
  const text=String(raw).trim();
  return /^\d+$/.test(text)?Number(text):null;
}

async function recordStripeEvent(event,status='received',errorText=null){
  const payload=JSON.stringify(event);
  try{
    await db().execute(
      `INSERT INTO webhook_events(provider,external_event_id,event_type,payload_json,status,error_text,processed_at)
       VALUES('stripe',?,?,?,?,?,IF(? IN ('processed','ignored'),NOW(),NULL))
       ON DUPLICATE KEY UPDATE event_type=VALUES(event_type),payload_json=VALUES(payload_json),status=VALUES(status),error_text=VALUES(error_text),processed_at=VALUES(processed_at)`,
      [event.id,event.type,payload,status,errorText,status]
    );
  }catch(e){
    console.error('stripe webhook event log failed',e);
  }
}

async function processStripeEvent(event){
  const obj=event.data?.object||{};
  const orderId=stripeOrderId(obj);
  const paymentIntentId=obj.payment_intent||obj.id||null;

  if(event.type==='payment_intent.succeeded'){
    if(!orderId)return {status:'ignored',reason:'missing_order_id'};
    await db().execute(
      `UPDATE orders SET status='paid',payment_provider='stripe',payment_reference=?,production_locked_at=COALESCE(production_locked_at,NOW()) WHERE id=?`,
      [String(obj.id||''),orderId]
    );
    await db().execute(
      `INSERT INTO notifications(store_id,type,title,body)
       SELECT store_id,'payment_received','Payment received',CONCAT('Stripe payment confirmed for order #',id,'. Ready for production review.') FROM orders WHERE id=?`,
      [orderId]
    );
    return {status:'processed',orderId};
  }

  if(event.type==='checkout.session.completed'){
    if(!orderId)return {status:'ignored',reason:'missing_order_id'};
    await db().execute(
      `UPDATE orders SET status='paid',payment_provider='stripe',payment_reference=?,production_locked_at=COALESCE(production_locked_at,NOW()) WHERE id=?`,
      [String(obj.payment_intent||obj.id||''),orderId]
    );
    await db().execute(
      `INSERT INTO notifications(store_id,type,title,body)
       SELECT store_id,'payment_received','Checkout completed',CONCAT('Stripe Checkout completed for order #',id,'. Ready for production review.') FROM orders WHERE id=?`,
      [orderId]
    );
    return {status:'processed',orderId};
  }

  if(event.type==='payment_intent.payment_failed'){
    if(orderId){
      await db().execute(
        `UPDATE orders SET status='pending',payment_provider='stripe',payment_reference=? WHERE id=?`,
        [String(obj.id||''),orderId]
      );
      await db().execute(
        `INSERT INTO notifications(store_id,type,title,body)
         SELECT store_id,'payment_failed','Payment failed',CONCAT('Stripe payment failed for order #',id,'. Production remains locked.') FROM orders WHERE id=?`,
        [orderId]
      );
    }
    return {status:'processed',orderId};
  }

  if(event.type==='charge.refunded'||event.type==='refund.updated'){
    const ref=String(paymentIntentId||'');
    if(ref){
      await db().execute(
        `UPDATE orders SET status='refunded' WHERE payment_provider='stripe' AND payment_reference=?`,
        [ref]
      );
    }
    return {status:'processed',paymentReference:ref||null};
  }

  return {status:'ignored',reason:'event_not_used'};
}

app.get('/api/stripe/webhook',(req,res)=>{
  res.json({ok:true,service:'madedeck-stripe-webhook',configured:!!(stripe&&process.env.STRIPE_WEBHOOK_SECRET),version:APP_VERSION});
});

app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{
  if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET){
    return res.status(503).json({ok:false,error:'stripe_webhook_not_configured'});
  }
  const signature=req.headers['stripe-signature'];
  let event;
  try{
    event=stripe.webhooks.constructEvent(req.body,signature,process.env.STRIPE_WEBHOOK_SECRET);
  }catch(e){
    console.warn('stripe webhook signature verification failed',e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
  try{
    await recordStripeEvent(event,'received');
    const result=await processStripeEvent(event);
    await recordStripeEvent(event,result.status);
    res.json({received:true,status:result.status});
  }catch(e){
    await recordStripeEvent(event,'failed',String(e.message||e));
    console.error('stripe webhook processing failed',e);
    res.status(500).json({ok:false,error:'webhook_processing_failed'});
  }
});

app.use(express.json());
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
function sessionHash(token){return crypto.createHash('sha256').update(String(token||'')).digest('hex');}
async function durableSession(req){
  const token=req.cookies.md_session;
  if(!token)return null;
  const [rows]=await db().execute(
    `SELECT u.id,u.email,u.role FROM auth_sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.status='active' LIMIT 1`,
    [sessionHash(token)]
  );
  const current=rows[0]||null;
  if(current)await db().execute('UPDATE auth_sessions SET last_seen_at=NOW() WHERE token_hash=?',[sessionHash(token)]);
  return current;
}
function requireUser(req,res,next){const s=session(req);if(!s)return res.status(401).json({ok:false,error:'login_required'});req.user=s;next();}
app.use('/api/swarm-power',createSwarmPowerRouter({db,session:durableSession}));
function cartRole(req){const s=session(req);if(!s)return 'customer';if(s.role==='platform_admin')return 'owner';return 'merchant';}
function paymentProviders(){return {
  paypal:!!process.env.PAYPAL_CLIENT_ID,
  stripe:!!process.env.STRIPE_SECRET_KEY,
  applepay:!!process.env.APPLE_PAY_MERCHANT_ID,
  googlepay:!!process.env.GOOGLE_PAY_MERCHANT_ID,
  cashapp:!!process.env.CASH_APP_PAYMENT_URL,
  merchant:!!process.env.MERCHANT_PAYMENT_URL
};}
function platformEconomics(subtotal){
  const percent=Math.max(0,Number(process.env.MADEDECK_PLATFORM_FEE_PERCENT||0));
  const fixed=Math.max(0,Number(process.env.MADEDECK_PLATFORM_FEE_FIXED||0));
  const platformFee=Math.max(0,(subtotal*(percent/100))+fixed);
  return {platform_fee:Number(platformFee.toFixed(2)),merchant_payout:Number(Math.max(0,subtotal-platformFee).toFixed(2))};
}
app.get('/health',async(req,res)=>{try{await db().query('SELECT 1');res.json({ok:true,mode:'database',database:'connected',version:APP_VERSION,stripe:{payments:!!stripe,webhook:!!process.env.STRIPE_WEBHOOK_SECRET}});}catch(e){res.status(503).json({ok:false,database:'disconnected',error:e.message});}});
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');const [rows]=await db().execute('SELECT id,email,password_salt,password_hash,role,status FROM users WHERE email=? LIMIT 1',[email]);const u=rows[0];if(!u||u.status!=='active'||!verifyPassword(password,u.password_salt,u.password_hash))return res.status(401).json({ok:false,error:'invalid_credentials'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{id:u.id,email:u.email,role:u.role});await db().execute(`INSERT INTO auth_sessions(user_id,token_hash,user_agent,ip_hash,expires_at) VALUES(?,?,?,?,DATE_ADD(NOW(),INTERVAL 12 HOUR))`,[u.id,sessionHash(token),String(req.headers['user-agent']||'').slice(0,500),sessionHash(req.ip||'')]);res.cookie('md_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12});res.json({ok:true,user:{email:u.email,role:u.role}});});
app.post('/api/auth/logout',async(req,res)=>{const token=req.cookies.md_session;if(token){sessions.delete(token);await db().execute('UPDATE auth_sessions SET revoked_at=NOW() WHERE token_hash=?',[sessionHash(token)]);}res.clearCookie('md_session');res.json({ok:true});});
app.get('/api/me',requireUser,(req,res)=>res.json({ok:true,user:req.user}));
app.get('/api/cart/context',(req,res)=>res.json({ok:true,role:cartRole(req),providers:paymentProviders(),version:APP_VERSION}));
app.post('/api/checkout/preview',(req,res)=>{
  const subtotal=Math.max(0,Number(req.body.subtotal||0));
  const shipping=Math.max(0,Number(req.body.shipping||0));
  const provider=String(req.body.provider||'stripe');
  const providers=paymentProviders();
  const role=cartRole(req);
  const economics=platformEconomics(subtotal);
  const response={ok:true,role,provider,provider_enabled:!!providers[provider],totals:{subtotal,shipping,grand:Number((subtotal+shipping).toFixed(2))}};
  if(role!=='customer')response.economics={...economics,order_owner:role==='owner'?'MadeDeck platform':'Merchant store'};
  res.json(response);
});
app.get('/api/offers',requireUser,async(req,res)=>{const [rows]=await db().query('SELECT * FROM offers ORDER BY created_at DESC LIMIT 100');res.json({ok:true,offers:rows});});
app.post('/api/offers',requireUser,async(req,res)=>{const b=req.body;const type=['store','preorder','bulk'].includes(b.type)?b.type:'store';const access=['public','paid_customer','private_link'].includes(b.access_mode)?b.access_mode:'public';const fulfillment=['direct','office','both'].includes(b.fulfillment_mode)?b.fulfillment_mode:'both';const price=Number(b.retail_price),min=Number(b.minimum_qty||1);if(!b.store_id||!b.title||!Number.isFinite(price)||price<0)return res.status(400).json({ok:false,error:'invalid_offer'});const [r]=await db().execute('INSERT INTO offers(store_id,product_id,type,title,status,access_mode,fulfillment_mode,retail_price,minimum_qty,closes_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[b.store_id,b.product_id||null,type,b.title,'draft',access,fulfillment,price,Math.max(1,min),b.closes_at||null]);res.status(201).json({ok:true,id:r.insertId});});
app.get('/api/platform/features',requireUser,async(req,res)=>{if(req.user.role!=='platform_admin')return res.status(403).json({ok:false,error:'forbidden'});const [rows]=await db().query('SELECT * FROM feature_flags ORDER BY feature_key');res.json({ok:true,features:rows});});
async function boot(){
  await db().query('SELECT 1');
  await seedUser(process.env.SEED_ADMIN_EMAIL,process.env.SEED_ADMIN_PASSWORD,'platform_admin');
  await seedUser(process.env.SEED_MERCHANT_EMAIL,process.env.SEED_MERCHANT_PASSWORD,'merchant_admin');
  const swarmOwner=await ensureVinnyEntitlement(db());
  console.log(`Swarm Power owner configured=${swarmOwner.configured} granted=${swarmOwner.granted}`);
  const [merchantRows]=await db().execute('SELECT id FROM users WHERE email=? LIMIT 1',[String(process.env.SEED_MERCHANT_EMAIL||'').toLowerCase()]);
  const merchant=merchantRows[0];
  if(merchant){
    await db().execute("UPDATE stores SET owner_user_id=? WHERE id=1",[merchant.id]);
    await db().execute("INSERT INTO store_members(store_id,user_id,member_role) VALUES(1,?,'owner') ON DUPLICATE KEY UPDATE member_role='owner'",[merchant.id]);
  }
  const port=Number(process.env.PORT||3000);
  app.listen(port,()=>console.log(`MadeDeck listening on ${port}`));
}
boot().catch(e=>{console.error(e);process.exit(1);});