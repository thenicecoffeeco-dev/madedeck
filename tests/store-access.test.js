'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {validStoreId,isPlatformOwner,canAccessStore,listOffers}=require('../src/store-access');

test('store ids must be positive safe integers',()=>{
  assert.equal(validStoreId('7'),7);
  assert.equal(validStoreId('7x'),null);
  assert.equal(validStoreId(-1),null);
});

test('only immutable MadeDeck super context receives platform scope',()=>{
  assert.equal(isPlatformOwner({accountKey:'madedeck',role:'super'}),true);
  assert.equal(isPlatformOwner({accountKey:'madedeck',role:'customer'}),false);
  assert.equal(isPlatformOwner({accountKey:'other',role:'super'}),false);
});

test('merchant store access is scoped to its tenant membership',async()=>{
  const queries=[];
  const database={execute:async(sql,params)=>{queries.push({sql,params});return [[]];}};
  const context={accountId:4,userId:9,accountKey:'shop',role:'merchant',storeId:12};
  assert.equal(await canAccessStore(database,context,12),true);
  assert.equal(await canAccessStore(database,context,13),false);
  assert.deepEqual(queries[0].params,[4,9,13]);
});

test('offer listing adds store scope for merchants',async()=>{
  const calls=[];
  const database={execute:async(sql,params)=>{calls.push({sql,params});return [[{id:1,store_id:12}]];}};
  const rows=await listOffers(database,{accountId:4,userId:9,accountKey:'shop',role:'merchant',storeId:12});
  assert.equal(rows.length,1);
  assert.match(calls[0].sql,/WHERE store_id=\?/);
  assert.deepEqual(calls[0].params,[12]);
});

test('platform owner retains explicit audited all-store view',async()=>{
  const calls=[];
  const database={execute:async(sql,params)=>{calls.push({sql,params});return [[]];}};
  await listOffers(database,{accountId:1,userId:20,accountKey:'madedeck',role:'super',storeId:null});
  assert.doesNotMatch(calls[0].sql,/WHERE store_id/);
});
