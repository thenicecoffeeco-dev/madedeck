'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {bootstrapPlatformOwner,ensureAccountMembership}=require('../src/tenant-foundation');

test('owner bootstrap is inert when no address is configured',async()=>{
  const database={execute(){throw new Error('database must not be touched');}};
  assert.deepEqual(await bootstrapPlatformOwner(database,''),{configured:false,assigned:false,reason:'email_not_configured'});
});

test('owner bootstrap refuses a non-admin identity',async()=>{
  const database={execute:async()=>[[{id:7,email:'owner@example.com',role:'merchant_admin'}]]};
  assert.deepEqual(await bootstrapPlatformOwner(database,'OWNER@example.com'),{configured:true,assigned:false,reason:'platform_admin_required'});
});

test('membership resolution trusts immutable owner id before ordinary memberships',async()=>{
  const calls=[];
  const ownerMembership={membership_id:3,account_id:1,account_key:'madedeck',account_type:'platform',role_key:'super'};
  const database={execute:async(sql,params)=>{calls.push({sql,params});return [[ownerMembership]];}};
  const result=await ensureAccountMembership(database,{id:9,email:'new-address@example.com'});
  assert.equal(result,ownerMembership);
  assert.match(calls[0].sql,/tenant_identities/);
  assert.deepEqual(calls[0].params,[9]);
  assert.doesNotMatch(calls[0].sql,/email/i);
  assert.equal(calls.length,1);
});

test('existing non-owner membership remains stable without email inference',async()=>{
  const membership={membership_id:8,account_id:4,account_key:'shop',account_type:'merchant',role_key:'merchant'};
  let call=0;
  const database={execute:async()=>{call+=1;return call===1?[[]]:[[membership]];}};
  assert.equal(await ensureAccountMembership(database,{id:11,email:'owner@example.com'}),membership);
  assert.equal(call,2);
});
