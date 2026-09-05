'use strict';

const crypto=require('crypto');
const express=require('express');

function fail(status,code){const e=new Error(code);e.status=status;e.code=code;throw e}

function createBillingBridgeRouter({db,session,stripe,appUrl}){
  const router=express.Router();

  async function requireSession(req,res,next){
    try{const current=await session(req);if(!current)return res.status(401).json({ok:false,error:'login_required'});req.user=current;next()}catch(error){next(error)}
  }

  router.get('/offers',async(req,res,next)=>{
    try{
      const [rows]=await db().query(
        `SELECT offer_code,name,purchase_mode,tier_code,entitlement_key,credit_grant,price_cents,billing_interval,price_version,
                (stripe_price_id IS NOT NULL) stripe_ready,config_json
         FROM billing_offers WHERE active=1 ORDER BY FIELD(purchase_mode,'free','subscription','payment'),price_cents`
      );
      res.json({ok:true,authority:'database',offers:rows.map(r=>({...r,config:typeof r.config_json==='string'?JSON.parse(r.config_json):r.config_json,config_json:undefined}))});
    }catch(error){next(error)}
  });

  router.post('/checkout',requireSession,async(req,res,next)=>{
    try{
      if(!stripe)fail(503,'stripe_not_configured');
      const offerCode=String(req.body?.offer_code||'').trim();
      const [[offer]]=await db().execute('SELECT * FROM billing_offers WHERE offer_code=? AND active=1 LIMIT 1',[offerCode]);
      if(!offer)fail(404,'billing_offer_not_found');
      if(offer.purchase_mode==='free')fail(409,'free_offer_needs_no_checkout');
      if(!offer.stripe_price_id)fail(409,'stripe_test_price_not_verified');
      const attemptRef=crypto.randomUUID();
      const origin=String(appUrl||'').replace(/\/$/,'');
      const params={
        mode:offer.purchase_mode==='subscription'?'subscription':'payment',
        line_items:[{price:offer.stripe_price_id,quantity:1}],
        client_reference_id:String(req.user.id),
        customer_email:req.user.email,
        success_url:`${origin}/member-account.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:`${origin}/member-account.html?checkout=canceled`,
        metadata:{madedeck_user_id:String(req.user.id),madedeck_account_id:String(req.user.account_id||''),offer_code:offer.offer_code,attempt_ref:attemptRef},
        integration_identifier:`madedeck_${crypto.randomBytes(4).toString('hex')}`
      };
      if(params.mode==='subscription')params.subscription_data={metadata:{madedeck_user_id:String(req.user.id),madedeck_account_id:String(req.user.account_id||''),offer_code:offer.offer_code}};
      const checkout=await stripe.checkout.sessions.create(params,{idempotencyKey:`md:${req.user.id}:${offer.offer_code}:${String(req.get('Idempotency-Key')||attemptRef)}`});
      res.status(201).json({ok:true,checkout:{id:checkout.id,url:checkout.url},attempt_ref:attemptRef});
    }catch(error){next(error)}
  });

  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);console.error('billing bridge error',error.code||error.message);res.status(error.status||500).json({ok:false,error:error.code||'billing_bridge_error'})});
  return router;
}

module.exports={createBillingBridgeRouter};
