const express=require('express');
const path=require('path');
const fs=require('fs');
const cookieParser=require('cookie-parser');
const crypto=require('crypto');
const Stripe=require('stripe');
const {db,verifyPassword,seedUser}=require('./db');
const {createSwarmPowerRouter,ensureVinnyEntitlement}=require('./swarm-power');
const {createDialerRouter}=require('./dialer');
const {createSystemMessagesRouter}=require('./system-messages');
const {createConnectionBackbone}=require('./connection-backbone');
const app=express();
const publicDir=path.join(__dirname,'../public');
const APP_VERSION='0.7.0';
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
const mockupDir=path.join(publicDir,'mockups');
const premadeDir=path.join(publicDir,'premades');
const assetStaticOptions={fallthrough:true,index:false,setHeaders:(res)=>{
  res.setHeader('Cache-Control','public, max-age=86400');
  res.setHeader('X-Content-Type-Options','nosniff');
}};
app.get('/api/assets/status',(req,res)=>{
  const samples={
    mockup:path.join(mockupDir,'tee','front-white.png'),
    premade:path.join(premadeDir,'cute-faces','10.png')
  };
  res.json({ok:true,version:APP_VERSION,public_dir:publicDir,assets:Object.fromEntries(Object.entries(samples).map(([key,file])=>[key,{exists:fs.existsSync(file),bytes:fs.existsSync(file)?fs.statSync(file).size:0,path:path.relative(publicDir,file)}]))});
});
app.use('/mockups',express.static(mockupDir,assetStaticOptions));
app.use('/premades',express.static(premadeDir,assetStaticOptions));
app.get('/',(req,res)=>{
  try{
    const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8')
      .replace('href="/styles.css"',`href="/styles.css?v=${APP_VERSION}"`)
      .replace('href="/admin.css"',`href="/admin.css?v=${APP_VERSION}"`)
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
  const cached=sessions.get(token);
  if(cached)return cached;
  const [rows]=await db().execute(
    `SELECT u.id,u.email,u.role,s.account_id,s.store_id,s.profile_key,s.acting_role,
            a.account_key,a.account_type
     FROM auth_sessions s JOIN users u ON u.id=s.user_id
     LEFT JOIN accounts a ON a.id=s.account_id
     WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.status='active' LIMIT 1`,
    [sessionHash(token)]
  );
  const current=rows[0]||null;
  if(current){
    sessions.set(token,current);
    await db().execute('UPDATE auth_sessions SET last_seen_at=NOW() WHERE token_hash=?',[sessionHash(token)]);
  }
  return current;
}
function requireUser(req,res,next){const s=session(req);if(!s)return res.status(401).json({ok:false,error:'login_required'});req.user=s;next();}
function requirePlatformAdmin(req,res,next){if(req.user?.role!=='platform_admin')return res.status(403).json({ok:false,error:'platform_admin_required'});next();}
app.use('/api/swarm-power',createSwarmPowerRouter({db,session:durableSession}));
app.use('/api/dialer',createDialerRouter({db,session:durableSession}));
app.use('/api/system-messages',createSystemMessagesRouter({db,session:durableSession}));
app.use('/api/backbone',createConnectionBackbone({db,production:process.env.NODE_ENV==='production'}).router);
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
async function ensureAccountMembership(user){
  const [existing]=await db().execute(
    `SELECT am.id membership_id,am.account_id,am.store_id,am.profile_key,am.role_key,
            am.permissions_json,am.subscription_json,a.account_key,a.account_type
     FROM account_memberships am JOIN accounts a ON a.id=am.account_id
     WHERE am.user_id=? AND am.status='active' AND a.status='active'
     ORDER BY (a.account_key='madedeck') DESC,am.id LIMIT 1`,[user.id]);
  if(existing[0])return existing[0];

  const ownerEmail=String(process.env.VINNY_OWNER_EMAIL||'').trim().toLowerCase();
  let accountKey,accountType,accountName,roleKey,storeId=null,profileKey=null;
  if(ownerEmail&&String(user.email).toLowerCase()===ownerEmail){
    accountKey='madedeck';accountType='platform';accountName='MadeDeck Platform';roleKey='super';
  }else{
    const [stores]=await db().execute(
      `SELECT s.id,s.slug,s.name FROM stores s LEFT JOIN store_members sm ON sm.store_id=s.id
       WHERE s.owner_user_id=? OR sm.user_id=? ORDER BY (s.owner_user_id=?) DESC,s.id LIMIT 1`,
      [user.id,user.id,user.id]);
    const store=stores[0];
    if(store){storeId=store.id;profileKey=store.slug;accountKey=store.slug;accountType='merchant';accountName=store.name;roleKey='merchant'}
    else{accountKey=`user-${user.id}`;accountType='subscriber';accountName=user.email;roleKey='customer';profileKey=accountKey}
  }
  await db().execute(
    `INSERT INTO accounts(account_key,account_type,name,status) VALUES(?,?,?,'active')
     ON DUPLICATE KEY UPDATE name=VALUES(name),status='active'`,
    [accountKey,accountType,accountName]);
  const [[account]]=await db().execute('SELECT id FROM accounts WHERE account_key=? LIMIT 1',[accountKey]);
  await db().execute(
    `INSERT INTO account_memberships(account_id,user_id,store_id,profile_key,role_key,status)
     VALUES(?,?,?,?,?,'active')
     ON DUPLICATE KEY UPDATE store_id=VALUES(store_id),profile_key=VALUES(profile_key),status='active'`,
    [account.id,user.id,storeId,profileKey,roleKey]);
  const [[created]]=await db().execute(
    `SELECT am.id membership_id,am.account_id,am.store_id,am.profile_key,am.role_key,
            am.permissions_json,am.subscription_json,a.account_key,a.account_type
     FROM account_memberships am JOIN accounts a ON a.id=am.account_id
     WHERE am.user_id=? AND am.account_id=? AND am.role_key=? LIMIT 1`,
    [user.id,account.id,roleKey]);
  return created;
}
app.post('/api/auth/login',async(req,res)=>{try{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');const [rows]=await db().execute('SELECT id,email,password_salt,password_hash,role,status FROM users WHERE email=? LIMIT 1',[email]);const u=rows[0];if(!u||u.status!=='active'||!verifyPassword(password,u.password_salt,u.password_hash))return res.status(401).json({ok:false,error:'invalid_credentials'});const membership=await ensureAccountMembership(u);const token=crypto.randomBytes(32).toString('hex'),sessionKey=crypto.randomUUID();const scoped={id:u.id,email:u.email,role:u.role,account_id:membership.account_id,account_key:membership.account_key,account_type:membership.account_type,store_id:membership.store_id,profile_key:membership.profile_key,acting_role:membership.role_key};sessions.set(token,scoped);try{await db().execute(`INSERT INTO auth_sessions(session_key,user_id,token_hash,account_id,membership_id,store_id,profile_key,acting_role,permissions_json,subscription_json,user_agent,ip_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 12 HOUR))`,[sessionKey,u.id,sessionHash(token),membership.account_id,membership.membership_id,membership.store_id,membership.profile_key,membership.role_key,membership.permissions_json,membership.subscription_json,String(req.headers['user-agent']||'').slice(0,500),sessionHash(req.ip||'')]);}catch(sessionError){console.error('durable session unavailable; using runtime session',sessionError.message);}res.cookie('md_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12});res.json({ok:true,user:{email:u.email,role:u.role,account_key:membership.account_key,profile_key:membership.profile_key,acting_role:membership.role_key}});}catch(error){console.error('login failed',error);res.status(500).json({ok:false,error:'login_service_error',detail:process.env.NODE_ENV==='production'?undefined:error.message});}});
app.post('/api/auth/logout',async(req,res)=>{const token=req.cookies.md_session;if(token){sessions.delete(token);await db().execute('UPDATE auth_sessions SET revoked_at=NOW() WHERE token_hash=?',[sessionHash(token)]);}res.clearCookie('md_session');res.json({ok:true});});
app.get('/api/me',requireUser,(req,res)=>res.json({ok:true,user:req.user}));
app.post('/api/inquiries',async(req,res)=>{const b=req.body||{};const email=String(b.email||'').trim().toLowerCase();if(!email||!email.includes('@'))return res.status(400).json({ok:false,error:'valid_email_required'});const [r]=await db().execute('INSERT INTO inquiries(name,email,company,source,message) VALUES(?,?,?,?,?)',[String(b.name||'').trim(),email,String(b.company||'').trim()||null,String(b.source||'website').slice(0,100),String(b.message||'').trim()||null]);res.status(201).json({ok:true,id:r.insertId});});
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
app.get('/api/platform/features',requireUser,requirePlatformAdmin,async(req,res)=>{const [rows]=await db().query('SELECT * FROM feature_flags ORDER BY feature_key');res.json({ok:true,features:rows});});
app.get('/api/platform/monetization',requireUser,requirePlatformAdmin,async(req,res)=>{
  const [[plans],[modules],[subscriptions],[inquiries],[wallets],[orders]]=await Promise.all([
    db().query('SELECT * FROM platform_plans ORDER BY sort_order,name'),
    db().query('SELECT * FROM platform_modules ORDER BY sort_order,name'),
    db().query(`SELECT s.id,s.plan_code,s.status,s.renews_at,st.name store_name,st.support_email FROM subscriptions s JOIN stores st ON st.id=s.store_id ORDER BY s.created_at DESC LIMIT 200`),
    db().query('SELECT id,name,email,company,source,status,created_at FROM inquiries ORDER BY created_at DESC LIMIT 200'),
    db().query('SELECT COALESCE(SUM(balance),0) outstanding_credits,COALESCE(SUM(lifetime_purchased),0) purchased_credits,COALESCE(SUM(lifetime_used),0) used_credits FROM credit_wallets'),
    db().query(`SELECT COUNT(*) order_count,COALESCE(SUM(total),0) gross_sales,COALESCE(SUM(CASE WHEN status IN ('paid','production','shipped','ready_office','completed') THEN total ELSE 0 END),0) collected_sales FROM orders`)
  ]);
  const activeSubscriptions=subscriptions.filter(x=>x.status==='active'||x.status==='trialing').length;
  const monthlyRecurring=plans.reduce((sum,p)=>sum+(Number(p.monthly_price)*subscriptions.filter(s=>s.plan_code===p.code&&s.status==='active').length),0);
  res.json({ok:true,summary:{active_subscriptions:activeSubscriptions,total_subscriptions:subscriptions.length,new_inquiries:inquiries.filter(x=>x.status==='new').length,monthly_recurring_revenue:Number(monthlyRecurring.toFixed(2)),...wallets[0],...orders[0]},plans,modules,subscriptions,inquiries});
});
app.patch('/api/platform/plans/:id',requireUser,requirePlatformAdmin,async(req,res)=>{const b=req.body||{};const price=Number(b.monthly_price),credits=Number(b.included_credits);if(!Number.isFinite(price)||price<0||!Number.isInteger(credits)||credits<0)return res.status(400).json({ok:false,error:'invalid_plan_values'});await db().execute('UPDATE platform_plans SET monthly_price=?,included_credits=?,active=? WHERE id=?',[price,credits,b.active?1:0,req.params.id]);res.json({ok:true});});
app.patch('/api/platform/modules/:id',requireUser,requirePlatformAdmin,async(req,res)=>{const b=req.body||{};const price=Number(b.price),credits=Number(b.credit_cost);if(!Number.isFinite(price)||price<0||!Number.isInteger(credits)||credits<0)return res.status(400).json({ok:false,error:'invalid_module_values'});await db().execute('UPDATE platform_modules SET price=?,credit_cost=?,active=? WHERE id=?',[price,credits,b.active?1:0,req.params.id]);res.json({ok:true});});
app.patch('/api/platform/inquiries/:id',requireUser,requirePlatformAdmin,async(req,res)=>{const status=String(req.body.status||'');if(!['new','contacted','qualified','converted','closed'].includes(status))return res.status(400).json({ok:false,error:'invalid_status'});await db().execute('UPDATE inquiries SET status=? WHERE id=?',[status,req.params.id]);res.json({ok:true});});
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
