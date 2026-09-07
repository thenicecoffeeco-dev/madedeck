'use strict';

const express=require('express');
const {validStoreId,isPlatformOwner,canAccessStore}=require('./store-access');

function createOperationsRouter({db,access}){
  const router=express.Router();
  const guard=[access.resolve,access.authenticated,access.tenant,access.authorize('orders.view')];

  router.get('/orders',...guard,async(req,res,next)=>{
    try{
      const context=req.authContext,requested=validStoreId(req.query.store_id);
      if(requested&&!await canAccessStore(db(),context,requested))return res.status(403).json({ok:false,error:'store_scope_denied',request_id:req.requestId});
      const params=[];let where='';
      if(!isPlatformOwner(context)){const storeId=requested||validStoreId(context.storeId);if(!storeId)return res.json({ok:true,orders:[]});where='WHERE o.store_id=?';params.push(storeId)}
      else if(requested){where='WHERE o.store_id=?';params.push(requested)}
      const [rows]=await db().execute(
        `SELECT o.id,o.store_id,s.name store_name,o.customer_email,o.customer_name,o.status,o.fulfillment_mode,
          o.subtotal,o.shipping,o.tax,o.total,o.payment_provider,o.created_at,o.updated_at,
          COUNT(oi.id) item_count,COALESCE(SUM(oi.quantity),0) unit_count
         FROM orders o JOIN stores s ON s.id=o.store_id LEFT JOIN order_items oi ON oi.order_id=o.id
         ${where} GROUP BY o.id ORDER BY o.created_at DESC LIMIT 250`,params);
      res.json({ok:true,orders:rows});
    }catch(error){next(error)}
  });

  router.get('/customers',...guard,async(req,res,next)=>{
    try{
      const context=req.authContext,requested=validStoreId(req.query.store_id);
      if(requested&&!await canAccessStore(db(),context,requested))return res.status(403).json({ok:false,error:'store_scope_denied',request_id:req.requestId});
      const params=[];let where="WHERE o.customer_email IS NOT NULL AND o.customer_email<>''";
      if(!isPlatformOwner(context)){const storeId=requested||validStoreId(context.storeId);if(!storeId)return res.json({ok:true,customers:[]});where+=' AND o.store_id=?';params.push(storeId)}
      else if(requested){where+=' AND o.store_id=?';params.push(requested)}
      const [rows]=await db().execute(
        `SELECT LOWER(o.customer_email) email,MAX(o.customer_name) name,COUNT(*) order_count,
          SUM(CASE WHEN o.status NOT IN ('cancelled','refunded') THEN o.total ELSE 0 END) lifetime_value,
          MAX(o.created_at) last_order_at,COUNT(DISTINCT o.store_id) store_count
         FROM orders o ${where} GROUP BY LOWER(o.customer_email) ORDER BY last_order_at DESC LIMIT 250`,params);
      res.json({ok:true,customers:rows});
    }catch(error){next(error)}
  });

  return router;
}

module.exports={createOperationsRouter};
