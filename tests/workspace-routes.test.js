'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {cleanKey,parseJson}=require('../src/workspace-routes');
const {MIGRATIONS,splitSql}=require('../src/migration-runner');

test('tenant workspace keys reject unsafe or ambiguous paths',()=>{
  assert.equal(cleanKey('design-123'), 'design-123');
  assert.equal(cleanKey('tenant:1.design_2'), 'tenant:1.design_2');
  assert.equal(cleanKey('../other-tenant'), null);
  assert.equal(cleanKey('spaces are rejected'), null);
  assert.equal(cleanKey(''), null);
});

test('workspace JSON parsing fails closed',()=>{
  assert.deepEqual(parseJson('{"ok":true}'),{ok:true});
  assert.equal(parseJson('{broken'),null);
});

test('additive workspace migration is registered and portable',()=>{
  const key='013_tenant_design_product_workspaces.sql';
  assert.ok(MIGRATIONS.includes(key));
  const sql=fs.readFileSync(path.join(__dirname,'../db/migrations',key),'utf8');
  const statements=splitSql(sql);
  assert.equal(statements.length,2);
  assert.match(statements[0],/CREATE TABLE IF NOT EXISTS tenant_designs/);
  assert.match(statements[1],/CREATE TABLE IF NOT EXISTS tenant_saved_products/);
  assert.doesNotMatch(sql,/FOREIGN KEY/i);
});
