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

function createWorkspaceRouter({db,access}){
  const router=express.Router();
  const guard=[access.resolve,access.authenticated,access.tenant,access.authorize('maker.use')];

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
