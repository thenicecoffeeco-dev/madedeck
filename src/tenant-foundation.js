'use strict';

const crypto=require('crypto');

function cleanEmail(value){return String(value||'').trim().toLowerCase();}

async function bootstrapPlatformOwner(database,email){
  const ownerEmail=cleanEmail(email);
  const connection=typeof database.getConnection==='function'?await database.getConnection():database;
  try{
    if(connection.beginTransaction)await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO accounts(account_key,account_type,name,status) VALUES('madedeck','platform','MadeDeck Platform','active') ON DUPLICATE KEY UPDATE status='active'");
    const [[account]]=await connection.execute(
      "SELECT id FROM accounts WHERE account_key='madedeck' LIMIT 1 FOR UPDATE");
    await connection.execute(
      'INSERT IGNORE INTO tenant_identities(account_id,tenant_uuid,owner_user_id) VALUES(?,UUID(),NULL)',[account.id]);
    const [[tenant]]=await connection.execute(
      'SELECT owner_user_id FROM tenant_identities WHERE account_id=? FOR UPDATE',[account.id]);
    let user;
    if(tenant.owner_user_id!==null){
      const [owners]=await connection.execute(
        "SELECT id,email,role FROM users WHERE id=? AND status='active' LIMIT 1",[tenant.owner_user_id]);
      user=owners[0];
      if(!user)throw new Error('assigned_platform_owner_unavailable');
    }else{
      if(!ownerEmail){
        if(connection.commit)await connection.commit();
        return {configured:false,assigned:false,reason:'email_not_configured'};
      }
      const [users]=await connection.execute(
        "SELECT id,email,role FROM users WHERE email=? AND status='active' LIMIT 1",[ownerEmail]);
      user=users[0];
      if(!user){
        if(connection.commit)await connection.commit();
        return {configured:true,assigned:false,reason:'user_not_found'};
      }
      if(user.role!=='platform_admin'){
        if(connection.commit)await connection.commit();
        return {configured:true,assigned:false,reason:'platform_admin_required'};
      }
      await connection.execute(
        'UPDATE tenant_identities SET owner_user_id=? WHERE account_id=? AND owner_user_id IS NULL',[user.id,account.id]);
    }
    await connection.execute(
      `INSERT INTO account_memberships(account_id,user_id,store_id,profile_key,role_key,status)
       VALUES(?,?,NULL,NULL,'super','active')
       ON DUPLICATE KEY UPDATE role_key='super',status='active'`,[account.id,user.id]);
    await connection.execute(
      'INSERT IGNORE INTO identity_emails(user_id,email,is_primary,verified_at) VALUES(?,?,1,NOW())',[user.id,cleanEmail(user.email)]);
    if(connection.commit)await connection.commit();
    return {configured:true,assigned:true,accountId:Number(account.id),userId:Number(user.id)};
  }catch(error){
    if(connection.rollback)await connection.rollback();
    throw error;
  }finally{
    if(connection!==database&&connection.release)connection.release();
  }
}

async function ensureAccountMembership(database,user){
  const [ownedTenants]=await database.execute(
    `SELECT ti.account_id,a.account_key,a.account_type
     FROM tenant_identities ti JOIN accounts a ON a.id=ti.account_id
     WHERE ti.owner_user_id=? AND a.status='active'
     ORDER BY (a.account_key='madedeck') DESC,ti.account_id LIMIT 1`,[user.id]);
  const ownedTenant=ownedTenants[0];
  if(ownedTenant){
    await database.execute(
      `INSERT INTO account_memberships(account_id,user_id,store_id,profile_key,role_key,status)
       VALUES(?,?,NULL,NULL,'super','active')
       ON DUPLICATE KEY UPDATE status='active'`,[ownedTenant.account_id,user.id]);
    const [[ownerMembership]]=await database.execute(
      `SELECT am.id membership_id,am.account_id,am.store_id,am.profile_key,am.role_key,
              am.permissions_json,am.subscription_json,a.account_key,a.account_type
       FROM account_memberships am JOIN accounts a ON a.id=am.account_id
       WHERE am.account_id=? AND am.user_id=? AND am.role_key='super' AND am.status='active' LIMIT 1`,
      [ownedTenant.account_id,user.id]);
    if(!ownerMembership)throw new Error('owner_membership_unavailable');
    return ownerMembership;
  }

  const [existing]=await database.execute(
    `SELECT am.id membership_id,am.account_id,am.store_id,am.profile_key,am.role_key,
            am.permissions_json,am.subscription_json,a.account_key,a.account_type
     FROM account_memberships am JOIN accounts a ON a.id=am.account_id
     WHERE am.user_id=? AND am.status='active' AND a.status='active'
     ORDER BY am.id LIMIT 1`,[user.id]);
  if(existing[0])return existing[0];

  const [stores]=await database.execute(
    `SELECT s.id,s.slug,s.name FROM stores s LEFT JOIN store_members sm ON sm.store_id=s.id
     WHERE s.owner_user_id=? OR sm.user_id=? ORDER BY (s.owner_user_id=?) DESC,s.id LIMIT 1`,
    [user.id,user.id,user.id]);
  const store=stores[0];
  const accountKey=store?store.slug:`user-${user.id}`;
  const accountType=store?'merchant':'subscriber';
  const accountName=store?store.name:user.email;
  const roleKey=store?'merchant':'customer';
  const storeId=store?store.id:null;
  const profileKey=store?store.slug:accountKey;
  await database.execute(
    `INSERT INTO accounts(account_key,account_type,name,status) VALUES(?,?,?,'active')
     ON DUPLICATE KEY UPDATE name=VALUES(name),status='active'`,
    [accountKey,accountType,accountName]);
  const [[account]]=await database.execute('SELECT id FROM accounts WHERE account_key=? LIMIT 1',[accountKey]);
  await database.execute(
    `INSERT INTO account_memberships(account_id,user_id,store_id,profile_key,role_key,status)
     VALUES(?,?,?,?,?,'active')
     ON DUPLICATE KEY UPDATE store_id=VALUES(store_id),profile_key=VALUES(profile_key),status='active'`,
    [account.id,user.id,storeId,profileKey,roleKey]);
  const [[created]]=await database.execute(
    `SELECT am.id membership_id,am.account_id,am.store_id,am.profile_key,am.role_key,
            am.permissions_json,am.subscription_json,a.account_key,a.account_type
     FROM account_memberships am JOIN accounts a ON a.id=am.account_id
     WHERE am.user_id=? AND am.account_id=? AND am.role_key=? LIMIT 1`,
    [user.id,account.id,roleKey]);
  return created;
}

function createSecurityAudit(database){
  return async({req,context,permission,outcome,reason,targetAccountId})=>{
    try{
      await database.execute(
        `INSERT INTO security_audit_events
         (event_ref,request_id,account_id,actor_user_id,actor_session_key,action,outcome,resource_type,detail_json)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(),req.requestId||null,targetAccountId||context?.accountId||null,
          context?.userId||null,context?.sessionKey||null,permission,outcome,'tenant',
          JSON.stringify(reason?{reason}: {})]);
    }catch(error){
      console.error('security audit write failed',error.message);
    }
  };
}

module.exports={bootstrapPlatformOwner,ensureAccountMembership,createSecurityAudit,cleanEmail};
