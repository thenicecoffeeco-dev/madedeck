const express=require('express');
const path=require('path');
const cookieParser=require('cookie-parser');
const crypto=require('crypto');
const {db,verifyPassword,seedUser}=require('./db');
const app=express();
app.use(express.json());app.use(express.urlencoded({extended:false}));app.use(cookieParser());app.use(express.static(path.join(__dirname,'../public')));
const sessions=new Map();
function session(req){const token=req.cookies.md_session;return token?sessions.get(token):null;}
function requireUser(req,res,next){const s=session(req);if(!s)return res.status(401).json({ok:false,error:'login_required'});req.user=s;next();}
app.get('/health',async(req,res)=>{try{await db().query('SELECT 1');res.json({ok:true,mode:'database',database:'connected',version:'0.2.0'});}catch(e){res.status(503).json({ok:false,database:'disconnected',error:e.message});}});
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');const [rows]=await db().execute('SELECT id,email,password_salt,password_hash,role,status FROM users WHERE email=? LIMIT 1',[email]);const u=rows[0];if(!u||u.status!=='active'||!verifyPassword(password,u.password_salt,u.password_hash))return res.status(401).json({ok:false,error:'invalid_credentials'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{id:u.id,email:u.email,role:u.role});res.cookie('md_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:1000*60*60*12});res.json({ok:true,user:{email:u.email,role:u.role}});});
app.post('/api/auth/logout',(req,res)=>{if(req.cookies.md_session)sessions.delete(req.cookies.md_session);res.clearCookie('md_session');res.json({ok:true});});
app.get('/api/me',requireUser,(req,res)=>res.json({ok:true,user:req.user}));
app.get('/api/offers',requireUser,async(req,res)=>{const [rows]=await db().query('SELECT * FROM offers ORDER BY created_at DESC LIMIT 100');res.json({ok:true,offers:rows});});
app.post('/api/offers',requireUser,async(req,res)=>{const b=req.body;const type=['store','preorder','bulk'].includes(b.type)?b.type:'store';const access=['public','paid_customer','private_link'].includes(b.access_mode)?b.access_mode:'public';const fulfillment=['direct','office','both'].includes(b.fulfillment_mode)?b.fulfillment_mode:'both';const price=Number(b.retail_price),min=Number(b.minimum_qty||1);if(!b.store_id||!b.title||!Number.isFinite(price)||price<0)return res.status(400).json({ok:false,error:'invalid_offer'});const [r]=await db().execute('INSERT INTO offers(store_id,product_id,type,title,status,access_mode,fulfillment_mode,retail_price,minimum_qty,closes_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[b.store_id,b.product_id||null,type,b.title,'draft',access,fulfillment,price,Math.max(1,min),b.closes_at||null]);res.status(201).json({ok:true,id:r.insertId});});
app.get('/api/platform/features',requireUser,async(req,res)=>{if(req.user.role!=='platform_admin')return res.status(403).json({ok:false,error:'forbidden'});const [rows]=await db().query('SELECT * FROM feature_flags ORDER BY feature_key');res.json({ok:true,features:rows});});
async function boot(){await db().query('SELECT 1');await seedUser(process.env.SEED_ADMIN_EMAIL,process.env.SEED_ADMIN_PASSWORD,'platform_admin');await seedUser(process.env.SEED_MERCHANT_EMAIL,process.env.SEED_MERCHANT_PASSWORD,'merchant_admin');const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log(`MadeDeck listening on ${port}`));}
boot().catch(e=>{console.error(e);process.exit(1);});
