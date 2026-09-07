'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {bootstrapPlatformOwner,transferPlatformOwner,ensureAccountMembership}=require('../src/tenant-foundation');

test('owner bootstrap refuses a non-admin identity before assignment',async()=>{
  let call=0;
  const database={execute:async()=>{
    call+=1;
    if(call===2)return [[{id:1}]];
    if(call===4)return [[{owner_user_id:null}]];
    if(call===5)return [[{id:7,email:'owner@example.com',role:'merchant_admin'}]];
    return [[]];
  }};
  assert.deepEqual(await bootstrapPlatformOwner(database,'OWNER@example.com'),{configured:true,assigned:false,reason:'platform_admin_required'});
});

test('membership resolution trusts immutable owner id before ordinary memberships',async()=>{
  const calls=[];
  const ownerMembership={membership_id:3,account_id:1,account_key:'madedeck',account_type:'platform',role_key:'super'};
  let call=0;
  const database={execute:async(sql,params)=>{
    calls.push({sql,params});call+=1;
    if(call===1)return [[{account_id:1,account_key:'madedeck',account_type:'platform'}]];
    if(call===2)return [{affectedRows:1}];
    return [[ownerMembership]];
  }};
  const result=await ensureAccountMembership(database,{id:9,email:'new-address@example.com'});
  assert.equal(result,ownerMembership);
  assert.match(calls[0].sql,/tenant_identities/);
  assert.deepEqual(calls[0].params,[9]);
  assert.doesNotMatch(calls[0].sql,/email/i);
  assert.match(calls[1].sql,/role_key,status/);
  assert.deepEqual(calls[2].params,[1,9]);
  assert.equal(calls.length,3);
});

test('existing non-owner membership remains stable without email inference',async()=>{
  const membership={membership_id:8,account_id:4,account_key:'shop',account_type:'merchant',role_key:'merchant'};
  let call=0;
  const database={execute:async()=>{call+=1;return call===1?[[]]:[[membership]];}};
  assert.equal(await ensureAccountMembership(database,{id:11,email:'owner@example.com'}),membership);
  assert.equal(call,2);
});

test('owner transfer requires an exact deployment confirmation',async()=>{
  await assert.rejects(
    transferPlatformOwner({},{fromUserId:1,toUserId:20,toEmail:'madedeck@proton.me',confirmation:'yes'}),
    /owner_transfer_confirmation_mismatch/
  );
});

test('owner transfer is idempotent after target owns the tenant',async()=>{
  let committed=false;
  const connection={
    beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},
    execute:async()=>[[{account_id:1,owner_user_id:20}]]
  };
  const result=await transferPlatformOwner(connection,{fromUserId:1,toUserId:20,toEmail:'madedeck@proton.me',confirmation:'madedeck:1:20'});
  assert.equal(result.alreadyCompleted,true);
  assert.equal(committed,true);
});

test('owner transfer derives ids from exact confirmation when host omits redundant fields',async()=>{
  const connection={
    beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},
    execute:async()=>[[{account_id:1,owner_user_id:20}]]
  };
  const result=await transferPlatformOwner(connection,{toEmail:'madedeck@proton.me',confirmation:'madedeck:1:20'});
  assert.equal(result.alreadyCompleted,true);
  assert.equal(result.userId,20);
});

test('owner transfer stays disabled after recovery secrets are removed',async()=>{
  const database={execute(){throw new Error('database must not be touched');}};
  assert.deepEqual(await transferPlatformOwner(database,{toEmail:'madedeck@proton.me'}),{configured:false,transferred:false});
});
