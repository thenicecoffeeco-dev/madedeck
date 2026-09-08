'use strict';

const express=require('express');

function cleanKey(value){
  const key=String(value||'').trim();
  return /^[A-Za-z0-9._:-]{1,100}$/.test(key)?key:null;
}
function cleanJson(value,maxBytes=1500000){
  const text=JSON.stringify(value??{});
  if(Buffer.byteLength(text,'utf8')>maxBytes)throw new Error('payload_too_large');
  return text;
}
function parseJson(value){try{return typeof value==='string'?JSON.parse(value):value}catch{return null}}
function cleanText(value,max){return String(value||'').trim().slice(0,max)}
function cleanSlug(value){const slug=String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);return slug||null}
function cleanUrl(value){const text=cleanText(value,500);if(!text)return'';try{const url=new URL(text);return ['http:','https:','mailto:'].includes(url.protocol)?url.toString():''}catch{return''}}

function createWorkspaceRouter({db,access}){
  const router=express.Router();
  const guard=[access.resolve,access.authenticated,access.tenant,access.authorize('maker.use')];

  router.get('/profile',...guard,async(req,res,next)=>{
    try{
      const [rows]=await db().execute('SELECT account_key,account_type,name,metadata_json FROM accounts WHERE id=? AND status=\'active\' LIMIT 1',[req.authContext.accountId]);
      const account=rows[0];if(!account)return res.status(404).json({ok:false,error:'account_not_found',request_id:req.requestId});
      const metadata=parseJson(account.metadata_json)||{},store=metadata.store||{};
      const [[countRows]] = await Promise.all([db().execute('SELECT COUNT(*) AS total FROM tenant_saved_products WHERE account_id=?',[req.authContext.accountId])]);
      res.json({ok:true,profile:{account_key:account.account_key,account_type:account.account_type,display_name:store.display_name||account.name,store_name:store.name||account.name,slug:store.slug||account.account_key,bio:store.bio||'',daily_message:store.daily_message||'',logo_data:store.logo_data||'',links:Array.isArray(store.links)?store.links:[],plan_key:metadata.plan_key||'free',product_limit:Number(metadata.product_limit||3),product_count:Number(countRows[0]?.total||0),onboarding_complete:!!store.onboarding_complete,storefront_published:!!store.storefront_published,payout_status:metadata.payout?.status||'not_started'}});
    }catch(error){next(error)}
  });

  router.put('/profile',...guard,async(req,res,next)=>{
    try{
      const body=req.body||{},slug=cleanSlug(body.slug),name=cleanText(body.store_name,160),displayName=cleanText(body.display_name,160);
      if(!slug||!name||!displayName)return res.status(400).json({ok:false,error:'valid_store_profile_required',request_id:req.requestId});
      const logo=String(body.logo_data||'');
      if(logo&&(!/^data:image\/(png|jpeg|webp);base64,/i.test(logo)||Buffer.byteLength(logo,'utf8')>900000))return res.status(413).json({ok:false,error:'logo_must_be_png_jpeg_or_webp_under_650kb',request_id:req.requestId});
      const links=(Array.isArray(body.links)?body.links:[]).slice(0,3).map(item=>({label:cleanText(item?.label,60),url:cleanUrl(item?.url)})).filter(item=>item.label&&item.url);
      const [conflicts]=await db().execute("SELECT id FROM accounts WHERE id<>? AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.store.slug'))=? LIMIT 1",[req.authContext.accountId,slug]);
      if(conflicts[0])return res.status(409).json({ok:false,error:'store_slug_taken',request_id:req.requestId});
      const [rows]=await db().execute('SELECT metadata_json FROM accounts WHERE id=? LIMIT 1',[req.authContext.accountId]);
      const metadata=parseJson(rows[0]?.metadata_json)||{},previous=metadata.store||{};
      metadata.plan_key=metadata.plan_key||'free';metadata.product_limit=Math.max(1,Number(metadata.product_limit||3));
      metadata.store={...previous,display_name:displayName,name,slug,bio:cleanText(body.bio,1200),daily_message:cleanText(body.daily_message,500),logo_data:logo||previous.logo_data||'',links,onboarding_complete:true,storefront_published:body.storefront_published===true||previous.storefront_published===true,updated_at:new Date().toISOString()};
      await db().execute('UPDATE accounts SET name=?,metadata_json=? WHERE id=?',[name,cleanJson(metadata),req.authContext.accountId]);
      res.json({ok:true,profile:metadata.store,plan_key:metadata.plan_key,product_limit:metadata.product_limit});
    }catch(error){if(error.message==='payload_too_large')return res.status(413).json({ok:false,error:error.message});next(error)}
  });

  router.get('/designs',...guard,async(req,res,next)=>{
    try{
      const [rows]=await db().execute(
        `SELECT design_key,name,product_key,status,schema_version,design_json,created_at,updated_at
         FROM tenant_designs WHERE account_id=? ORDER BY updated_at DESC LIMIT 200`,
        [req.authContext.accountId]);
      res.json({ok:true,designs:rows.map(row=>({...row,design:parseJson(row.design_json),design_json:undefined}))});
    }catch(error){next(error)}
  });

  router.put('/designs/:key',...guard,async(req,res,next)=>{
    try{
      const key=cleanKey(req.params.key),body=req.body||{},name=String(body.name||'Untitled design').trim().slice(0,120);
      if(!key||!body.design||typeof body.design!=='object')return res.status(400).json({ok:false,error:'invalid_design',request_id:req.requestId});
      const productKey=String(body.product_key||body.design.product||'tee').trim().slice(0,60);
      const schemaVersion=Math.max(1,Math.min(100,Number(body.schema_version||body.design.schema||7)||7));
      const json=cleanJson(body.design);
      await db().execute(
        `INSERT INTO tenant_designs(design_key,account_id,store_id,owner_user_id,name,product_key,status,schema_version,design_json)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE store_id=VALUES(store_id),owner_user_id=VALUES(owner_user_id),name=VALUES(name),
          product_key=VALUES(product_key),status=VALUES(status),schema_version=VALUES(schema_version),design_json=VALUES(design_json)`,
        [key,req.authContext.accountId,req.authContext.storeId,req.authContext.userId,name,productKey,'draft',schemaVersion,json]);
      res.json({ok:true,design_key:key});
    }catch(error){if(error.message==='payload_too_large')return res.status(413).json({ok:false,error:error.message});next(error)}
  });

  router.delete('/designs/:key',...guard,async(req,res,next)=>{
    try{
      const key=cleanKey(req.params.key);if(!key)return res.status(400).json({ok:false,error:'invalid_design_key'});
      const [result]=await db().execute('DELETE FROM tenant_designs WHERE account_id=? AND design_key=?',[req.authContext.accountId,key]);
      res.json({ok:true,deleted:result.affectedRows>0});
    }catch(error){next(error)}
  });

  router.get('/products',...guard,async(req,res,next)=>{
    try{
      const [rows]=await db().execute(
        `SELECT product_key,catalog_product_id,name,status,retail_price,product_json,created_at,updated_at
         FROM tenant_saved_products WHERE account_id=? ORDER BY updated_at DESC LIMIT 200`,
        [req.authContext.accountId]);
      res.json({ok:true,products:rows.map(row=>({...row,product:parseJson(row.product_json),product_json:undefined}))});
    }catch(error){next(error)}
  });

  router.put('/products/:key',...guard,async(req,res,next)=>{
    try{
      const key=cleanKey(req.params.key),body=req.body||{},name=String(body.name||body.product?.name||'Untitled product').trim().slice(0,160),price=Number(body.retail_price??body.product?.retail_price??0);
      if(!key||!body.product||typeof body.product!=='object'||!Number.isFinite(price)||price<0)return res.status(400).json({ok:false,error:'invalid_product',request_id:req.requestId});
      const json=cleanJson(body.product);
      const [existing]=await db().execute('SELECT product_key FROM tenant_saved_products WHERE account_id=? AND product_key=? LIMIT 1',[req.authContext.accountId,key]);
      if(!existing[0]&&req.authContext.role!=='super'){
        const [[accountRows],[countRows]]=await Promise.all([db().execute('SELECT metadata_json FROM accounts WHERE id=? LIMIT 1',[req.authContext.accountId]),db().execute('SELECT COUNT(*) AS total FROM tenant_saved_products WHERE account_id=?',[req.authContext.accountId])]);
        const metadata=parseJson(accountRows[0]?.metadata_json)||{},limit=Math.max(1,Number(metadata.product_limit||3));
        if(Number(countRows[0]?.total||0)>=limit)return res.status(409).json({ok:false,error:'free_product_limit_reached',limit,request_id:req.requestId});
      }
      await db().execute(
        `INSERT INTO tenant_saved_products(product_key,account_id,store_id,owner_user_id,catalog_product_id,name,status,retail_price,product_json)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE store_id=VALUES(store_id),owner_user_id=VALUES(owner_user_id),catalog_product_id=VALUES(catalog_product_id),
          name=VALUES(name),status=VALUES(status),retail_price=VALUES(retail_price),product_json=VALUES(product_json)`,
        [key,req.authContext.accountId,req.authContext.storeId,req.authContext.userId,body.catalog_product_id||null,name,'draft',price,json]);
      res.json({ok:true,product_key:key});
    }catch(error){if(error.message==='payload_too_large')return res.status(413).json({ok:false,error:error.message});next(error)}
  });

  return router;
}

module.exports={createWorkspaceRouter,cleanKey,parseJson};
