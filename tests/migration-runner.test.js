'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {splitSql,checksum,executePortable,MIGRATIONS}=require('../src/migration-runner');

test('splits statements without breaking quoted semicolons',()=>{
  const sql="-- comment\nCREATE TABLE x(v VARCHAR(20)); INSERT INTO x VALUES('a;b'); # tail\nUPDATE x SET v=\"c;d\";";
  assert.deepEqual(splitSql(sql),["CREATE TABLE x(v VARCHAR(20))","INSERT INTO x VALUES('a;b')",'UPDATE x SET v="c;d"']);
});

test('ignores block comments and preserves backticks',()=>{
  assert.deepEqual(splitSql('/* a;b */ CREATE TABLE `odd;name` (id INT);'),['CREATE TABLE `odd;name` (id INT)']);
});

test('migration order is explicit and foundation first',()=>{
  assert.equal(MIGRATIONS[0],'002_saas_foundation.sql');
  assert.equal(MIGRATIONS.at(-1),'012_high_integrity_identity_access.sql');
});

test('checksums are stable',()=>{
  assert.equal(checksum('MadeDeck'),checksum('MadeDeck'));
  assert.notEqual(checksum('MadeDeck'),checksum('madedeck'));
});


test('emulates unsupported ADD COLUMN IF NOT EXISTS',async()=>{
  const calls=[];
  const connection={execute:async(sql,args)=>{calls.push(['execute',sql,args]);return [[],[]];},query:async sql=>{calls.push(['query',sql]);}};
  await executePortable(connection,'ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(80) NULL');
  assert.match(calls.at(-1)[1],/^ALTER TABLE users ADD COLUMN nickname/);
});

test('skips a conditional column that already exists',async()=>{
  let queried=false;
  const connection={execute:async()=>[[{exists:1}],[]],query:async()=>{queried=true;}};
  const result=await executePortable(connection,'ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(80) NULL');
  assert.equal(result.skipped,true);
  assert.equal(queried,false);
});
