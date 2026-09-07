'use strict';

function validStoreId(value){
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
}

function isPlatformOwner(context){
  return context?.accountKey==='madedeck'&&context?.role==='super';
}

async function canAccessStore(database,context,storeId){
  const id=validStoreId(storeId);
  if(!id||!context)return false;
  if(isPlatformOwner(context))return true;
  if(Number(context.storeId)===id)return true;
  const [rows]=await database.execute(
    `SELECT 1 FROM account_memberships
     WHERE account_id=? AND user_id=? AND store_id=? AND status='active' LIMIT 1`,
    [context.accountId,context.userId,id]);
  return rows.length>0;
}

async function listOffers(database,context,limit=100){
  const safeLimit=Math.min(100,Math.max(1,Number(limit)||100));
  if(isPlatformOwner(context)){
    const [rows]=await database.execute(`SELECT * FROM offers ORDER BY created_at DESC LIMIT ${safeLimit}`);
    return rows;
  }
  const storeId=validStoreId(context?.storeId);
  if(!storeId)return [];
  const [rows]=await database.execute(
    `SELECT * FROM offers WHERE store_id=? ORDER BY created_at DESC LIMIT ${safeLimit}`,[storeId]);
  return rows;
}

module.exports={validStoreId,isPlatformOwner,canAccessStore,listOffers};
