const express=require('express');
const path=require('path');
const fs=require('fs');
const cookieParser=require('cookie-parser');
const crypto=require('crypto');
const Stripe=require('stripe');
const {db,hashPassword,verifyPassword,seedUser}=require('./db');
const {createSwarmPowerRouter,ensureVinnyEntitlement}=require('./swarm-power');
const {createDialerRouter}=require('./dialer');
const {createSystemMessagesRouter}=require('./system-messages');
const {createConnectionBackbone}=require('./connection-backbone');
const {runConfiguredMigrations}=require('./migration-runner');
const {createAccessControl}=require('./access-control');
const {bootstrapPlatformOwner,transferPlatformOwner,ensureAccountMembership,createSecurityAudit}=require('./tenant-foundation');
const {validStoreId,canAccessStore,listOffers}=require('./store-access');
const {createWorkspaceRouter}=require('./workspace-routes');
const {createOperationsRouter}=require('./operations-routes');
const {createStorefrontRouter}=require('./storefront-routes');
const app=express();
const publicDir=path.join(__dirname,'../public');
const APP_VERSION='0.12.1';
let migrationState={mode:'not_checked',ready:false,migrations:[]};
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;

const COMMERCE_OFFERS=Object.freeze([
  {code:'launch',kind:'subscription',audience:'member',name:'Launch',amount_cents:0,interval:null,credits:5,plan_key:'free',product_limit:3,summary:'One public store, up to 3 products, Maker access, receipts and delivery inbox.'},
  {code:'creator_monthly',kind:'subscription',audience:'member',name:'Creator',amount_cents:1900,interval:'month',credits:25,plan_key:'creator',product_limit:10,price_env:'STRIPE_PRICE_CREATOR_MONTHLY',summary:'25 credits monthly and up to 10 published products.'},
  {code:'creator_annual',kind:'subscription',audience:'member',name:'Creator annual',amount_cents:19000,interval:'year',credits:25,plan_key:'creator',product_limit:10,price_env:'STRIPE_PRICE_CREATOR_ANNUAL',summary:'Two months free; 25 credits are released each month.'},
  {code:'pro_monthly',kind:'subscription',audience:'member',name:'Pro',amount_cents:3900,interval:'month',credits:75,plan_key:'pro',product_limit:50,price_env:'STRIPE_PRICE_PRO_MONTHLY',summary:'75 credits monthly and up to 50 published products.'},
  {code:'pro_annual',kind:'subscription',audience:'member',name:'Pro annual',amount_cents:39000,interval:'year',credits:75,plan_key:'pro',product_limit:50,price_env:'STRIPE_PRICE_PRO_ANNUAL',summary:'Two months free; 75 credits are released each month.'},
  {code:'studio_monthly',kind:'subscription',audience:'member',name:'Studio',amount_cents:7900,interval:'month',credits:200,plan_key:'studio',product_limit:250,price_env:'STRIPE_PRICE_STUDIO_MONTHLY',summary:'200 credits monthly and up to 250 published products.'},
  {code:'studio_annual',kind:'subscription',audience:'member',name:'Studio annual',amount_cents:79000,interval:'year',credits:200,plan_key:'studio',product_limit:250,price_env:'STRIPE_PRICE_STUDIO_ANNUAL',summary:'Two months free; 200 credits are released each month.'},
  {code:'partner_network',kind:'subscription',audience:'partner',name:'Partner Network',amount_cents:null,interval:null,credits:0,plan_key:'partner',product_limit:0,summary:'Isolated partner reporting, attributed referrals and payout visibility. Approval required.'},
  {code:'partner_embedded',kind:'subscription',audience:'partner',name:'Embedded Partner',amount_cents:null,interval:null,credits:0,plan_key:'partner_embed',product_limit:0,summary:'Branded embed, scoped API access and isolated downstream tenants. Approval required.'},
  ...[[100,1000],[500,3900],[1500,9900],[5000,24900],[15000,59900]].map(([credits,amount])=>({code:`credits_${credits}`,kind:'credits',audience:'member',name:`${credits} credits`,amount_cents:amount,interval:null,credits,price_env:`STRIPE_PRICE_CREDITS_${credits}`,summary:'Purchased credits never expire.'}))
]);
const commerceOffer=code=>COMMERCE_OFFERS.find(item=>item.code===String(code||''));
const publicOffer=item=>({code:item.code,kind:item.kind,audience:item.audience,name:item.name,amount_cents:item.amount_cents,interval:item.interval,credits:item.credits,summary:item.summary,configured:item.amount_cents===0||!!(item.price_env&&process.env[item.price_env])});
function commerceMetadata(obj){const m=obj?.metadata||{};return m.madedeck_commerce==='1'?{accountId:Number(m.madedeck_account_id),userId:Number(m.madedeck_user_id),offer:commerceOffer(m.madedeck_offer_code)}:null}
async function processCommerceEvent(event,obj){
  const meta=commerceMetadata(obj);if(!meta?.offer||!Number.isSafeInteger(meta.accountId)||!Number.isSafeInteger(meta.userId))return null;
  const [members]=await db().execute("SELECT id FROM account_memberships WHERE account_id=? AND user_id=? AND status='active' LIMIT 1",[meta.accountId,meta.userId]);
  if(!members[0])throw Error('commerce_membership_scope_mismatch');
  if(event.type==='checkout.session.completed'){
    const paid=obj.payment_status==='paid'||obj.payment_status==='no_payment_required';if(!paid)return {status:'ignored',reason:'commerce_checkout_not_paid'};
    const connection=await db().getConnection();try{await connection.beginTransaction();
      await connection.execute(`INSERT INTO account_commerce_purchases(account_id,user_id,offer_code,purchase_kind,stripe_checkout_session_id,stripe_payment_intent_id,amount_total,currency,status) VALUES(?,?,?,?,?,?,?,?, 'paid') ON DUPLICATE KEY UPDATE stripe_payment_intent_id=VALUES(stripe_payment_intent_id),amount_total=VALUES(amount_total),currency=VALUES(currency),status='paid'`,[meta.accountId,meta.userId,meta.offer.code,meta.offer.kind,String(obj.id),obj.payment_intent?String(obj.payment_intent):null,Number(obj.amount_total||meta.offer.amount_cents||0),String(obj.currency||'usd').toUpperCase()]);
      if(meta.offer.kind==='credits')await connection.execute(`INSERT IGNORE INTO account_credit_ledger(account_id,user_id,bucket,amount,offer_code,stripe_event_id,source_id,expires_at) VALUES(?,?,?,?,?,?,?,NULL)`,[meta.accountId,meta.userId,'purchased',meta.offer.credits,meta.offer.code,event.id,String(obj.id)]);
      if(meta.offer.kind==='subscription'){
        const subscriptionId=String(obj.subscription||'');if(!subscriptionId)throw Error('commerce_subscription_missing');
        await connection.execute(`INSERT INTO account_subscriptions(account_id,owner_user_id,offer_code,plan_key,stripe_subscription_id,stripe_customer_id,status,monthly_credit_grant,next_credit_grant_at) VALUES(?,?,?,?,?,?, 'active',?,DATE_ADD(NOW(),INTERVAL 1 MONTH)) ON DUPLICATE KEY UPDATE offer_code=VALUES(offer_code),plan_key=VALUES(plan_key),stripe_customer_id=VALUES(stripe_customer_id),status='active',monthly_credit_grant=VALUES(monthly_credit_grant),next_credit_grant_at=VALUES(next_credit_grant_at)`,[meta.accountId,meta.userId,meta.offer.code,meta.offer.plan_key,subscriptionId,obj.customer?String(obj.customer):null,meta.offer.credits]);
        await connection.execute(`INSERT IGNORE INTO account_credit_ledger(account_id,user_id,bucket,amount,offer_code,stripe_event_id,source_id,expires_at) VALUES(?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 3 MONTH))`,[meta.accountId,meta.userId,'subscription',meta.offer.credits,meta.offer.code,event.id,String(obj.id)]);
        const [accountRows]=await connection.execute('SELECT metadata_json FROM accounts WHERE id=? FOR UPDATE',[meta.accountId]);let metadata={};try{metadata=typeof accountRows[0]?.metadata_json==='string'?JSON.parse(accountRows[0].metadata_json):(accountRows[0]?.metadata_json||{})}catch{}
        metadata.plan_key=meta.offer.plan_key;metadata.product_limit=meta.offer.product_limit;metadata.subscription={offer_code:meta.offer.code,status:'active',stripe_subscription_id:subscriptionId};
        await connection.execute('UPDATE accounts SET metadata_json=? WHERE id=?',[JSON.stringify(metadata),meta.accountId]);
        await connection.execute("UPDATE account_memberships SET role_key='merchant' WHERE account_id=? AND user_id=? AND status='active'",[meta.accountId,meta.userId]);
        await connection.execute("UPDATE auth_sessions SET acting_role='merchant' WHERE account_id=? AND user_id=? AND revoked_at IS NULL",[meta.accountId,meta.userId]);
      }
      await connection.commit();return {status:'processed',commerce:true,accountId:meta.accountId};
    }catch(error){await connection.rollback();throw error}finally{connection.release()}
  }
  if(event.type==='customer.subscription.updated'||event.type==='customer.subscription.deleted'){
    const status=event.type.endsWith('.deleted')?'canceled':String(obj.status||'active').slice(0,40);
    await db().execute('UPDATE account_subscriptions SET status=?,current_period_end=FROM_UNIXTIME(?) WHERE stripe_subscription_id=?',[status,Number(obj.current_period_end||0)||null,String(obj.id)]);
    if(status==='canceled'||status==='unpaid'||status==='incomplete_expired'){
      const [rows]=await db().execute('SELECT metadata_json FROM accounts WHERE id=?',[meta.accountId]);let metadata={};try{metadata=typeof rows[0]?.metadata_json==='string'?JSON.parse(rows[0].metadata_json):(rows[0]?.metadata_json||{})}catch{}
      metadata.plan_key='free';metadata.product_limit=3;metadata.subscription={...(metadata.subscription||{}),status};
      await db().execute('UPDATE accounts SET metadata_json=? WHERE id=?',[JSON.stringify(metadata),meta.accountId]);
      await db().execute("UPDATE account_memberships SET role_key='creator' WHERE account_id=? AND user_id=? AND status='active'",[meta.accountId,meta.userId]);
      await db().execute("UPDATE auth_sessions SET acting_role='creator' WHERE account_id=? AND user_id=? AND revoked_at IS NULL",[meta.accountId,meta.userId]);
    }
    return {status:'processed',commerce:true,accountId:meta.accountId};
  }
  return null;
}

async function grantDueSubscriptionCredits(accountId){
  const connection=await db().getConnection();try{await connection.beginTransaction();
    const [rows]=await connection.execute("SELECT id,owner_user_id,offer_code,monthly_credit_grant,next_credit_grant_at FROM account_subscriptions WHERE account_id=? AND status IN ('active','trialing') AND next_credit_grant_at IS NOT NULL AND next_credit_grant_at<=NOW() FOR UPDATE",[accountId]);
    for(const row of rows){let due=new Date(row.next_credit_grant_at),count=0;while(due<=new Date()&&count<3){const source=`subscription:${row.id}:${due.toISOString().slice(0,7)}`;await connection.execute(`INSERT IGNORE INTO account_credit_ledger(account_id,user_id,bucket,amount,offer_code,stripe_event_id,source_id,expires_at) VALUES(?,?,?,?,?,?,?,DATE_ADD(?,INTERVAL 3 MONTH))`,[accountId,row.owner_user_id,'subscription',row.monthly_credit_grant,row.offer_code,source,source,due]);due.setUTCMonth(due.getUTCMonth()+1);count++}await connection.execute('UPDATE account_subscriptions SET next_credit_grant_at=? WHERE id=?',[due,row.id])}
    await connection.commit();
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

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
  const commerceResult=await processCommerceEvent(event,obj);if(commerceResult)return commerceResult;
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

app.use(express.json({limit:'2mb'}));
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
      .replace('</head>',`<link rel="stylesheet" href="/commerce.css?v=${APP_VERSION}"></head>`)
      .replace('src="/app.js"',`src="/app.js?v=${APP_VERSION}"`)
      .replace('</nav>',`<a href="/?page=pricing#mdCommerce">Pricing</a><a href="/?page=partner-pricing#mdCommerce">Partners</a></nav>`)
      .replace('</main>',`<section id="mdCommerce" aria-label="MadeDeck pricing"></section></main>`)
      .replace('</body>',`<script src="/cart-v05.js?v=${APP_VERSION}"></script><script src="/commerce.js?v=${APP_VERSION}"></script></body>`);
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma','no-cache');
    res.set('Expires','0');
    res.type('html').send(html);
  }catch(e){res.status(500).send('MadeDeck frontend unavailable');}
});
app.get('/member',(req,res)=>res.redirect(302,'/member-account.html?module=member-workspace'));
app.get('/studio',(req,res)=>res.redirect(302,'/member-account.html?module=private-product-studio'));
app.get('/member-account.html',async(req,res,next)=>{
  try{
    const user=await durableSession(req);
    if(!user)return res.redirect(302,'/?auth=required');
    const role=String(user.acting_role||'customer').replace(/[^a-z_]/g,'');
    const platformAccess=role==='super'||role==='operator';
    if(!platformAccess&&['control-room','pricing-controls','urgent-review'].includes(String(req.query.module||'')))return res.redirect(302,'/member-account.html?module=member-workspace');
    const scopeCss=platformAccess?'':`<style id="serverTenantGate">#profileSelect,#resetDemo,[data-view="store"],[data-view="control"],#view-store,#view-control,#provisionModal{display:none!important}</style>`;
    const html=fs.readFileSync(path.join(publicDir,'member-account.html'),'utf8')
      .replace('</head>',`<link rel="stylesheet" href="/commerce.css?v=${APP_VERSION}">${scopeCss}</head>`)
      .replace('<body>',`<body data-auth-role="${role}">`)
      .replace('</body>',`<script src="/account-runtime.js?v=${APP_VERSION}"></script></body>`);
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.type('html').send(html);
  }catch(error){next(error)}
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
  if(cached){
    if(cached.account_type!=='platform'&&cached.acting_role==='merchant'){
      const [accountRows]=await db().execute('SELECT metadata_json FROM accounts WHERE id=? LIMIT 1',[cached.account_id]);
      let metadata={};try{metadata=typeof accountRows[0]?.metadata_json==='string'?JSON.parse(accountRows[0].metadata_json):(accountRows[0]?.metadata_json||{})}catch{}
      if(metadata.created_via==='public_signup')cached.acting_role=(metadata.plan_key||'free')==='free'?'creator':'merchant';
    }
    return cached;
  }
  const [rows]=await db().execute(
    `SELECT u.id,u.email,u.role,s.session_key,s.account_id,s.store_id,s.profile_key,s.acting_role,
            s.permissions_json,s.subscription_json,
            a.account_key,a.account_type,a.metadata_json
     FROM auth_sessions s JOIN users u ON u.id=s.user_id
     LEFT JOIN accounts a ON a.id=s.account_id
     WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.status='active' LIMIT 1`,
    [sessionHash(token)]
  );
  const current=rows[0]||null;
  if(current){
    let metadata={};
    try{metadata=typeof current.metadata_json==='string'?JSON.parse(current.metadata_json):(current.metadata_json||{})}catch{}
    if(current.account_type!=='platform'&&metadata.created_via==='public_signup')current.acting_role=(metadata.plan_key||'free')==='free'?'creator':'merchant';
    delete current.metadata_json;
    sessions.set(token,current);
    await db().execute('UPDATE auth_sessions SET last_seen_at=NOW() WHERE token_hash=?',[sessionHash(token)]);
  }
  return current;
}
async function requireUser(req,res,next){try{const s=await durableSession(req);if(!s)return res.status(401).json({ok:false,error:'login_required'});req.user=s;next()}catch(error){next(error)}}
function requirePlatformAdmin(req,res,next){if(req.user?.role!=='platform_admin')return res.status(403).json({ok:false,error:'platform_admin_required'});next();}
app.use('/api/swarm-power',createSwarmPowerRouter({db,session:durableSession}));
app.use('/api/dialer',createDialerRouter({db,session:durableSession}));
app.use('/api/system-messages',createSystemMessagesRouter({db,session:durableSession}));
app.use('/api/backbone',createConnectionBackbone({db:db(),production:process.env.NODE_ENV==='production'}).router);
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
app.get('/health',async(req,res)=>{try{await db().query('SELECT 1');res.json({ok:true,mode:'database',database:'connected',version:APP_VERSION,migrations:{mode:migrationState.mode,ready:migrationState.ready,pending:migrationState.migrations?.filter(x=>x.status==='pending').length||0,error:migrationState.blocking_error||null},stripe:{payments:!!stripe,webhook:!!process.env.STRIPE_WEBHOOK_SECRET}});}catch(e){res.status(503).json({ok:false,database:'disconnected',error:e.message});}});
app.post('/api/auth/register',async(req,res)=>{
  const name=String(req.body?.name||'').trim().slice(0,160);
  const company=String(req.body?.company||'').trim().slice(0,160);
  const email=String(req.body?.email||'').trim().toLowerCase();
  const password=String(req.body?.password||'');
  if(!name||!company||!email.includes('@'))return res.status(400).json({ok:false,error:'valid_name_company_email_required'});
  if(password.length<10)return res.status(400).json({ok:false,error:'password_must_be_at_least_10_characters'});
  const connection=await db().getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute('SELECT id FROM users WHERE email=? LIMIT 1',[email]);
    if(existing[0]){await connection.rollback();return res.status(409).json({ok:false,error:'email_already_registered'})}
    const {salt,hash}=hashPassword(password);
    const [userResult]=await connection.execute("INSERT INTO users(name,email,password_salt,password_hash,role,status) VALUES(?,?,?,?,?,'active')",[name,email,salt,hash,'merchant_admin']);
    const userId=Number(userResult.insertId);
    const baseKey=company.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'merchant';
    const accountKey=baseKey+'-'+crypto.randomBytes(3).toString('hex');
    const [accountResult]=await connection.execute("INSERT INTO accounts(account_key,account_type,name,status,metadata_json) VALUES(?,?,?,'active',?)",[accountKey,'merchant',company,JSON.stringify({launch:String(req.body?.launch||'').slice(0,160),created_via:'public_signup',plan_key:'free',product_limit:3})]);
    const accountId=Number(accountResult.insertId);
    await connection.execute('INSERT INTO tenant_identities(account_id,tenant_uuid,owner_user_id) VALUES(?,UUID(),?)',[accountId,userId]);
    const [membershipResult]=await connection.execute("INSERT INTO account_memberships(account_id,user_id,store_id,profile_key,role_key,status) VALUES(?,?,NULL,?,?,'active')",[accountId,userId,accountKey,'creator']);
    await connection.execute(`INSERT IGNORE INTO account_credit_ledger(account_id,user_id,bucket,amount,offer_code,stripe_event_id,source_id,expires_at) VALUES(?,?,'subscription',5,'launch',?,?,DATE_ADD(NOW(),INTERVAL 3 MONTH))`,[accountId,userId,`signup:${accountId}`,`signup:${accountId}`]);
    await connection.commit();
    const token=crypto.randomBytes(32).toString('hex'),sessionKey=crypto.randomUUID();
    const scoped={id:userId,email,role:'merchant_admin',session_key:sessionKey,account_id:accountId,account_key:accountKey,account_type:'merchant',store_id:null,profile_key:accountKey,acting_role:'creator',permissions_json:null,subscription_json:null};
    sessions.set(token,scoped);
    await db().execute(`INSERT INTO auth_sessions(session_key,user_id,token_hash,account_id,membership_id,store_id,profile_key,acting_role,permissions_json,subscription_json,user_agent,ip_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 12 HOUR))`,[sessionKey,userId,sessionHash(token),accountId,Number(membershipResult.insertId),null,accountKey,'creator',null,null,String(req.headers['user-agent']||'').slice(0,500),sessionHash(req.ip||'')]);
    res.cookie('md_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12});
    res.status(201).json({ok:true,user:{id:userId,email,role:'merchant_admin',account_id:accountId,account_key:accountKey,acting_role:'creator'},redirect:'/member-account.html?module=member-workspace&onboarding=1'});
  }catch(error){
    try{await connection.rollback()}catch{}
    console.error('registration failed',error);
    res.status(500).json({ok:false,error:'account_creation_failed'});
  }finally{connection.release()}
});
app.post('/api/auth/login',async(req,res)=>{try{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');const [rows]=await db().execute('SELECT id,email,password_salt,password_hash,role,status FROM users WHERE email=? LIMIT 1',[email]);const u=rows[0];if(!u||u.status!=='active'||!verifyPassword(password,u.password_salt,u.password_hash))return res.status(401).json({ok:false,error:'invalid_credentials'});const membership=await ensureAccountMembership(db(),u);const token=crypto.randomBytes(32).toString('hex'),sessionKey=crypto.randomUUID();const scoped={id:u.id,email:u.email,role:u.role,session_key:sessionKey,account_id:membership.account_id,account_key:membership.account_key,account_type:membership.account_type,store_id:membership.store_id,profile_key:membership.profile_key,acting_role:membership.role_key,permissions_json:membership.permissions_json,subscription_json:membership.subscription_json};sessions.set(token,scoped);try{await db().execute(`INSERT INTO auth_sessions(session_key,user_id,token_hash,account_id,membership_id,store_id,profile_key,acting_role,permissions_json,subscription_json,user_agent,ip_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 12 HOUR))`,[sessionKey,u.id,sessionHash(token),membership.account_id,membership.membership_id,membership.store_id,membership.profile_key,membership.role_key,membership.permissions_json,membership.subscription_json,String(req.headers['user-agent']||'').slice(0,500),sessionHash(req.ip||'')]);}catch(sessionError){console.error('durable session unavailable; using runtime session',sessionError.message);}res.cookie('md_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12});let redirect=u.role==='platform_admin'&&membership.role_key==='super'?'/member-account.html?module=control-room':'/member-account.html?module=private-product-studio';if(membership.account_type!=='platform'){const [accountRows]=await db().execute('SELECT metadata_json FROM accounts WHERE id=? LIMIT 1',[membership.account_id]);const metadata=accountRows[0]?.metadata_json;let parsed={};try{parsed=typeof metadata==='string'?JSON.parse(metadata):(metadata||{})}catch{}if(!parsed.store?.onboarding_complete)redirect='/member-account.html?module=member-workspace&onboarding=1'}res.json({ok:true,user:{email:u.email,role:u.role,account_key:membership.account_key,profile_key:membership.profile_key,acting_role:membership.role_key},redirect});}catch(error){console.error('login failed',error);res.status(500).json({ok:false,error:'login_service_error',detail:process.env.NODE_ENV==='production'?undefined:error.message});}});
app.post('/api/auth/logout',async(req,res)=>{const token=req.cookies.md_session;if(token){sessions.delete(token);await db().execute('UPDATE auth_sessions SET revoked_at=NOW() WHERE token_hash=?',[sessionHash(token)]);}res.clearCookie('md_session');res.json({ok:true});});
app.get('/api/me',async(req,res,next)=>{
  try{
    const user=await durableSession(req);
    if(!user)return res.status(401).json({ok:false,error:'login_required'});
    res.json({ok:true,user});
  }catch(error){next(error)}
});
const securityAudit=createSecurityAudit(db());
const tenantAccess=createAccessControl({session:durableSession,audit:securityAudit});
app.use('/api/workspace',createWorkspaceRouter({db,access:tenantAccess}));
app.use('/api/operations',createOperationsRouter({db,access:tenantAccess}));
app.use(createStorefrontRouter({db}));
app.get('/api/commerce/catalog',(req,res)=>res.json({ok:true,version:APP_VERSION,offers:COMMERCE_OFFERS.map(publicOffer)}));
app.get('/api/commerce/account',tenantAccess.resolve,tenantAccess.authenticated,tenantAccess.tenant,async(req,res,next)=>{try{
  await grantDueSubscriptionCredits(req.authContext.accountId);
  const [[credits],[subscriptions]]=await Promise.all([
    db().execute(`SELECT bucket,COALESCE(SUM(amount),0) balance FROM account_credit_ledger WHERE account_id=? AND (expires_at IS NULL OR expires_at>NOW()) GROUP BY bucket`,[req.authContext.accountId]),
    db().execute(`SELECT offer_code,plan_key,status,monthly_credit_grant,next_credit_grant_at,current_period_end FROM account_subscriptions WHERE account_id=? ORDER BY updated_at DESC`,[req.authContext.accountId])
  ]);
  const balances={subscription:0,purchased:0,adjustment:0};for(const row of credits)balances[row.bucket]=Number(row.balance||0);
  res.json({ok:true,account_id:req.authContext.accountId,role:req.authContext.role,balances,total:Object.values(balances).reduce((a,b)=>a+b,0),subscriptions});
}catch(error){next(error)}});
app.post('/api/commerce/checkout',tenantAccess.resolve,tenantAccess.authenticated,tenantAccess.tenant,async(req,res,next)=>{try{
  const offer=commerceOffer(req.body?.offer_code);if(!offer||offer.amount_cents===0||offer.amount_cents===null)return res.status(400).json({ok:false,error:'offer_not_purchasable',request_id:req.requestId});
  const role=req.authContext.role;if(role==='super'||role==='operator')return res.status(403).json({ok:false,error:'platform_account_cannot_purchase',request_id:req.requestId});
  if(role==='partner'&&offer.audience!=='partner')return res.status(403).json({ok:false,error:'partner_offer_required',request_id:req.requestId});
  if(role!=='partner'&&offer.audience!=='member')return res.status(403).json({ok:false,error:'member_offer_required',request_id:req.requestId});
  if(!stripe)return res.status(503).json({ok:false,error:'stripe_not_configured',request_id:req.requestId});const price=process.env[offer.price_env];if(!price)return res.status(503).json({ok:false,error:'stripe_price_not_configured',request_id:req.requestId});
  const origin=`${req.protocol}://${req.get('host')}`,metadata={madedeck_commerce:'1',madedeck_account_id:String(req.authContext.accountId),madedeck_user_id:String(req.authContext.userId),madedeck_offer_code:offer.code,madedeck_purchase_kind:offer.kind};
  const input={mode:offer.kind==='subscription'?'subscription':'payment',line_items:[{price,quantity:1}],metadata,client_reference_id:`${req.authContext.accountId}:${req.authContext.userId}:${offer.code}`,success_url:origin+'/member-account.html?module=member-workspace&commerce=success',cancel_url:origin+'/?page=pricing&commerce=cancelled#mdCommerce'};
  if(offer.kind==='subscription')input.subscription_data={metadata};
  const checkout=await stripe.checkout.sessions.create(input);
  await db().execute(`INSERT INTO account_commerce_purchases(account_id,user_id,offer_code,purchase_kind,stripe_checkout_session_id,amount_total,currency,status) VALUES(?,?,?,?,?,?,?,'pending') ON DUPLICATE KEY UPDATE status=VALUES(status)`,[req.authContext.accountId,req.authContext.userId,offer.code,offer.kind,checkout.id,offer.amount_cents,'USD']);
  res.json({ok:true,url:checkout.url,id:checkout.id});
}catch(error){next(error)}});
app.get('/api/v1/account/context',tenantAccess.resolve,tenantAccess.authenticated,tenantAccess.tenant,
  tenantAccess.authorize('tenant.settings.manage'),(req,res)=>{
    const c=req.authContext;
    res.json({ok:true,request_id:req.requestId,account:{id:c.accountId,key:c.accountKey,store_id:c.storeId,profile_key:c.profileKey},actor:{user_id:c.userId,role:c.role}});
  });
const checkoutCatalog=Object.freeze({
  tee:{name:'Unisex Standard Tee',base:1800},
  hoodie:{name:'Pullover Hoodie',base:2600},
  polo:{name:'Performance Polo',base:2900},
  hat:{name:'Premium Snapback',base:2700},
  koozie:{name:'Foam Koozie',base:550},
  towel:{name:'Golf Towel',base:3000},
  sticker2:{name:'2×2 Square Stickers · 200 pack',base:4500},
  sticker3:{name:'3×3 Square Stickers · 200 pack',base:5500},
  label54:{name:'5×4 Labels · 200 pack',base:7000}
});
function checkoutUnitAmount(item){
  const product=checkoutCatalog[String(item.productId||'')];if(!product)return null;
  const size={S:0,M:0,L:0,XL:0,'2X':200,'3X':400,'4X':600,'5X':800}[String(item.variant||'')]||0;
  const decorated=Object.values(item.surfaces||{}).filter(layers=>Array.isArray(layers)&&layers.length).length;
  const surfaces=Math.max(0,decorated-1)*600,method=/embroidery/i.test(String(item.method||''))?800:0;
  return {name:product.name,amount:product.base+size+surfaces+method};
}
app.post('/api/checkout/session',tenantAccess.resolve,tenantAccess.authenticated,tenantAccess.tenant,
  tenantAccess.authorize('maker.use'),async(req,res,next)=>{
    try{
      if(!stripe)return res.status(503).json({ok:false,error:'stripe_not_configured',request_id:req.requestId});
      const input=Array.isArray(req.body?.items)?req.body.items.slice(0,25):[];
      const priced=input.map(item=>({item,price:checkoutUnitAmount(item)}));
      if(!priced.length||priced.some(x=>!x.price))return res.status(400).json({ok:false,error:'invalid_checkout_items',request_id:req.requestId});
      const origin=`${req.protocol}://${req.get('host')}`;
      const checkout=await stripe.checkout.sessions.create({
        mode:'payment',
        customer_email:req.body?.customer?.email||req.authContext.email||undefined,
        line_items:priced.map(({item,price})=>({quantity:Math.max(1,Math.min(500,Number(item.quantity)||1)),price_data:{currency:'usd',unit_amount:price.amount,product_data:{name:price.name,metadata:{product_key:String(item.productId),variant:String(item.variant||''),method:String(item.method||'')}}}})),
        metadata:{madedeck_account_id:String(req.authContext.accountId),madedeck_user_id:String(req.authContext.userId),madedeck_session_key:String(req.authContext.sessionKey||'')},
        success_url:origin+'/member-account.html?module=member-receipts&checkout=success',
        cancel_url:origin+'/member-account.html?module=private-product-studio&checkout=cancelled'
      });
      res.json({ok:true,url:checkout.url,id:checkout.id});
    }catch(error){next(error)}
  });

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
app.get('/api/offers',tenantAccess.resolve,tenantAccess.authenticated,tenantAccess.tenant,
  tenantAccess.authorize('products.create'),async(req,res)=>{
    const rows=await listOffers(db(),req.authContext,req.query.limit);
    res.json({ok:true,offers:rows});
  });
app.post('/api/offers',tenantAccess.resolve,tenantAccess.authenticated,tenantAccess.tenant,
  tenantAccess.authorize('products.create'),async(req,res)=>{
    const b=req.body||{},storeId=validStoreId(b.store_id);
    const type=['store','preorder','bulk'].includes(b.type)?b.type:'store';
    const access=['public','paid_customer','private_link'].includes(b.access_mode)?b.access_mode:'public';
    const fulfillment=['direct','office','both'].includes(b.fulfillment_mode)?b.fulfillment_mode:'both';
    const price=Number(b.retail_price),min=Number(b.minimum_qty||1);
    if(!storeId||!b.title||!Number.isFinite(price)||price<0)return res.status(400).json({ok:false,error:'invalid_offer',request_id:req.requestId});
    if(!await canAccessStore(db(),req.authContext,storeId)){
      await securityAudit({req,context:req.authContext,permission:'products.create',outcome:'denied',reason:'store_scope_denied',targetAccountId:req.authContext.accountId});
      return res.status(403).json({ok:false,error:'store_scope_denied',request_id:req.requestId});
    }
    const [r]=await db().execute('INSERT INTO offers(store_id,product_id,type,title,status,access_mode,fulfillment_mode,retail_price,minimum_qty,closes_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[storeId,b.product_id||null,type,b.title,'draft',access,fulfillment,price,Math.max(1,min),b.closes_at||null]);
    res.status(201).json({ok:true,id:r.insertId});
  });
app.get('/api/platform/features',requireUser,requirePlatformAdmin,async(req,res)=>{const [rows]=await db().query('SELECT * FROM feature_flags ORDER BY feature_key');res.json({ok:true,features:rows});});
app.get('/api/platform/accounts',requireUser,requirePlatformAdmin,async(req,res,next)=>{try{
  const [rows]=await db().query(`SELECT a.id,a.account_key,a.account_type,a.name,a.status,a.metadata_json,
    u.email owner_email,u.name owner_name,
    (SELECT COUNT(*) FROM account_memberships m WHERE m.account_id=a.id AND m.status='active') member_count,
    (SELECT COUNT(*) FROM tenant_saved_products p WHERE p.account_id=a.id) product_count
    FROM accounts a LEFT JOIN tenant_identities ti ON ti.account_id=a.id
    LEFT JOIN users u ON u.id=ti.owner_user_id ORDER BY a.id DESC LIMIT 500`);
  const accounts=rows.map(row=>{let metadata={};try{metadata=typeof row.metadata_json==='string'?JSON.parse(row.metadata_json):(row.metadata_json||{})}catch{}const store=metadata.store||{};return{id:row.id,account_key:row.account_key,account_type:row.account_type,name:store.name||row.name,status:row.status,owner_email:row.owner_email||'',owner_name:row.owner_name||'',plan_key:metadata.plan_key||'unassigned',product_limit:Number(metadata.product_limit||0),product_count:Number(row.product_count||0),member_count:Number(row.member_count||0),onboarding_complete:!!store.onboarding_complete,storefront_published:!!store.storefront_published};});
  res.json({ok:true,accounts});
}catch(error){next(error)}});
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
app.use((error,req,res,next)=>{
  console.error('MadeDeck request failed',req.method,req.originalUrl,error.message);
  if(res.headersSent)return next(error);
  const code=/tenant_designs|tenant_saved_products|doesn't exist|does not exist/i.test(String(error.message||''))?503:500;
  res.status(code).json({ok:false,error:code===503?'workspace_schema_not_applied':'internal_error',request_id:req.requestId||null});
});

async function boot(){
  await db().query('SELECT 1');
  try{
    migrationState=await runConfiguredMigrations({db:db(),mode:process.env.DB_MIGRATION_MODE||'check'});
    console.log(`Database migrations mode=${migrationState.mode} ready=${migrationState.ready}`);
  }catch(error){
    migrationState={mode:process.env.DB_MIGRATION_MODE||'check',ready:false,migrations:[],blocking_error:String(error.message||error)};
    console.error('Database migration blocked:',migrationState.blocking_error);
  }
  await seedUser(process.env.SEED_ADMIN_EMAIL,process.env.SEED_ADMIN_PASSWORD,'platform_admin');
  await seedUser(process.env.SEED_MERCHANT_EMAIL,process.env.SEED_MERCHANT_PASSWORD,'merchant_admin');
  try{
    const owner=await bootstrapPlatformOwner(db(),process.env.MADEDECK_BOOTSTRAP_OWNER_EMAIL||process.env.VINNY_OWNER_EMAIL||process.env.SEED_ADMIN_EMAIL);
    console.log(`MadeDeck owner configured=${owner.configured} assigned=${owner.assigned}${owner.reason?` reason=${owner.reason}`:''}`);
  }catch(error){
    migrationState={...migrationState,ready:false,blocking_error:'owner_bootstrap_conflict'};
    console.error('MadeDeck owner bootstrap blocked:',error.message);
  }
  try{
    const transfer=await transferPlatformOwner(db(),{
      fromUserId:process.env.MADEDECK_OWNER_TRANSFER_FROM_USER_ID,
      toUserId:process.env.MADEDECK_OWNER_TRANSFER_TO_USER_ID,
      toEmail:process.env.MADEDECK_OWNER_TRANSFER_TO_EMAIL||process.env.MADEDECK_BOOTSTRAP_OWNER_EMAIL||process.env.SEED_ADMIN_EMAIL||'madedeck@proton.me',
      confirmation:process.env.MADEDECK_OWNER_TRANSFER_CONFIRM
    });
    console.log(`MadeDeck owner transfer configured=${transfer.configured} transferred=${transfer.transferred}${transfer.alreadyCompleted?' already_completed=true':''}`);
  }catch(error){
    migrationState={...migrationState,ready:false,blocking_error:'owner_transfer_blocked'};
    console.error('MadeDeck owner transfer blocked:',error.message);
  }
  try{
    const swarmOwner=await ensureVinnyEntitlement(db);
    console.log(`Swarm Power owner configured=${swarmOwner.configured} granted=${swarmOwner.granted}`);
  }catch(error){
    migrationState={...migrationState,ready:false,blocking_error:'optional_schema_incomplete'};
    console.warn('Swarm Power initialization deferred until migrations are applied:',error.message);
  }
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
