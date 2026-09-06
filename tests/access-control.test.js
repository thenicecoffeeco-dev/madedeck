'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeContext,roleAllows,entitlementAllows,assertTenantResource,tenantStorageKey}=require('../src/access-control');

test('rejects a session without an immutable tenant context',()=>{
  assert.equal(normalizeContext({id:7,acting_role:'merchant'}),null);
});

test('normalizes tenant session without trusting email as ownership',()=>{
  const ctx=normalizeContext({id:7,email:'replaceable@example.com',account_id:42,account_key:'acme',acting_role:'merchant'});
  assert.equal(ctx.accountId,42);
  assert.equal(ctx.userId,7);
  assert.equal(Object.hasOwn(ctx,'email'),false);
});

test('deny by default and explicit deny beats role grant',()=>{
  const base=normalizeContext({id:1,account_id:4,acting_role:'merchant'});
  assert.equal(roleAllows(base,'orders.view'),true);
  assert.equal(roleAllows(base,'system.repair'),false);
  const denied=normalizeContext({id:1,account_id:4,acting_role:'merchant',permissions_json:{'orders.view':false}});
  assert.equal(roleAllows(denied,'orders.view'),false);
});

test('entitlements are independent of roles',()=>{
  const ctx=normalizeContext({id:1,account_id:4,acting_role:'merchant',subscription_json:{entitlements:{advanced_embeds:true}}});
  assert.equal(roleAllows(ctx,'embeds.manage'),true);
  assert.equal(entitlementAllows(ctx,'advanced_embeds'),true);
  assert.equal(entitlementAllows(ctx,'marketing_pro'),false);
});

test('tenant resource assertion blocks cross-account IDs',()=>{
  const ctx=normalizeContext({id:1,account_id:4,acting_role:'merchant'});
  assert.throws(()=>assertTenantResource(ctx,{account_id:5,id:99}),{code:'TENANT_SCOPE_DENIED'});
  assert.equal(assertTenantResource(ctx,{account_id:4,id:99}).id,99);
});

test('cache and storage keys are tenant namespaced',()=>{
  assert.equal(tenantStorageKey(12,'maker drafts','front/1'),'tenant:12:maker_drafts:front_1');
  assert.notEqual(tenantStorageKey(12,'cart','active'),tenantStorageKey(13,'cart','active'));
});
