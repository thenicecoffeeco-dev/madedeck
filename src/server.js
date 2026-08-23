const express=require('express');
const path=require('path');
const fs=require('fs');
const cookieParser=require('cookie-parser');
const crypto=require('crypto');
const {db,verifyPassword,seedUser}=require('./db');
const app=express();
const publicDir=path.join(__dirname,'../public');
const APP_VERSION='0.5.0';
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
function requireUser(req,res,next){const s=session(req);if(!s)return res.status(401).json({ok:false,error:'login_required'});req.user=s;next();}
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
app.get('/health',async(req,res)=>{try{await db().query('SELECT 1');res.json({ok:true,mode:'database',database:'connected',version:APP_VERSION});}catch(e){res.status(503).json({ok:false,database:'disconnected',error:e.message});}});
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');const [rows]=await db().execute('SELECT id,email,password_salt,password_hash,role,status FROM users WHERE email=? LIMIT 1',[email]);const u=rows[0];if(!u||u.status!=='active'||!verifyPassword(password,u.password_salt,u.password_hash))return res.status(401).json({ok:false,error:'invalid_credentials'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{id:u.id,email:u.email,role:u.role});res.cookie('md_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12});res.json({ok:true,user:{email:u.email,role:u.role}});});
app.post('/api/auth/logout',(req,res)=>{if(req.cookies.md_session)sessions.delete(req.cookies.md_session);res.clearCookie('md_session');res.json({ok:true});});
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
