'use strict';

const crypto=require('crypto');

const DEFAULT_ROLE_PERMISSIONS=Object.freeze({
  super:['*'],
  operator:['system.logs.view','reports.view'],
  repair:['system.logs.view','system.repair'],
  support:['orders.view','system.logs.view'],
  merchant:['maker.use','products.create','products.publish','storefront.manage','embeds.create','embeds.manage','orders.view','orders.fulfill','marketing.use','integrations.manage','communications.manage','reports.view','payouts.view','tenant.users.manage','tenant.settings.manage','api_keys.manage'],
  partner:['embeds.create','embeds.manage','reports.view','payouts.view'],
  creator:['maker.use','products.create'],
  subscriber:['maker.use'],
  customer:['maker.use'],
  staff:['orders.view'],
  guest:[]
});

function jsonObject(value){
  if(!value)return {};
  if(typeof value==='object'&&!Array.isArray(value))return value;
  try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}
}

function normalizeContext(raw){
  if(!raw)return null;
  const accountId=Number(raw.account_id);
  if(!Number.isSafeInteger(accountId)||accountId<1)return null;
  return Object.freeze({
    userId:Number(raw.id||raw.user_id),
    accountId,
    accountKey:String(raw.account_key||''),
    storeId:raw.store_id===null||raw.store_id===undefined?null:Number(raw.store_id),
    profileKey:raw.profile_key||null,
    platformRole:String(raw.role||''),
    role:String(raw.acting_role||raw.role_key||''),
    permissions:jsonObject(raw.permissions_json),
    subscription:jsonObject(raw.subscription_json),
    sessionKey:raw.session_key||null
  });
}

function roleAllows(context,permission){
  if(!context||!permission)return false;
  const explicit=context.permissions[permission];
  if(explicit===true)return true;
  if(explicit===false)return false;
  const grants=DEFAULT_ROLE_PERMISSIONS[context.role]||[];
  return grants.includes('*')||grants.includes(permission);
}

function entitlementAllows(context,entitlement){
  if(!entitlement)return true;
  const item=context?.subscription?.entitlements?.[entitlement];
  if(item===true)return true;
  if(item&&typeof item==='object'){
    if(item.enabled!==true)return false;
    if(item.expires_at&&Date.parse(item.expires_at)<=Date.now())return false;
    return true;
  }
  return false;
}

function requestId(req){
  const supplied=String(req.get?.('x-request-id')||'').trim();
  return /^[A-Za-z0-9._:-]{8,100}$/.test(supplied)?supplied:crypto.randomUUID();
}

function createAccessControl({session,audit}){
  if(typeof session!=='function')throw new TypeError('session resolver required');

  async function resolve(req,res,next){
    try{
      req.requestId=requestId(req);
      res.set?.('X-Request-Id',req.requestId);
      const raw=await session(req);
      req.authContext=normalizeContext(raw);
      next();
    }catch(error){next(error);}
  }

  function authenticated(req,res,next){
    if(!req.authContext)return res.status(401).json({ok:false,error:'login_required',request_id:req.requestId});
    next();
  }

  function tenant(req,res,next){
    if(!req.authContext?.accountId)return res.status(403).json({ok:false,error:'tenant_context_required',request_id:req.requestId});
    next();
  }

  function authorize(permission,{entitlement=null,resourceAccountId=null}={}){
    return async(req,res,next)=>{
      const context=req.authContext;
      const target=typeof resourceAccountId==='function'?Number(await resourceAccountId(req)):context?.accountId;
      let reason=null;
      if(!context)reason='login_required';
      else if(!target||target!==context.accountId)reason='tenant_scope_denied';
      else if(!roleAllows(context,permission))reason='permission_denied';
      else if(!entitlementAllows(context,entitlement))reason='entitlement_required';
      if(reason){
        if(audit)await audit({req,context,permission,outcome:'denied',reason,targetAccountId:target||null});
        return res.status(reason==='login_required'?401:403).json({ok:false,error:reason,request_id:req.requestId});
      }
      if(audit)await audit({req,context,permission,outcome:'allowed',targetAccountId:target});
      next();
    };
  }

  return {resolve,authenticated,tenant,authorize};
}

function assertTenantResource(context,resource){
  if(!context?.accountId||!resource?.account_id||Number(resource.account_id)!==context.accountId){
    const error=new Error('tenant_scope_denied');
    error.code='TENANT_SCOPE_DENIED';
    throw error;
  }
  return resource;
}

function tenantStorageKey(accountId,namespace,key){
  const id=Number(accountId);
  if(!Number.isSafeInteger(id)||id<1)throw new TypeError('valid account id required');
  const clean=value=>String(value||'').trim().replace(/[^A-Za-z0-9._-]/g,'_');
  const ns=clean(namespace),item=clean(key);
  if(!ns||!item)throw new TypeError('namespace and key required');
  return `tenant:${id}:${ns}:${item}`;
}

module.exports={createAccessControl,normalizeContext,roleAllows,entitlementAllows,assertTenantResource,tenantStorageKey,DEFAULT_ROLE_PERMISSIONS};
