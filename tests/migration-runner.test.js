'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {splitSql,checksum,MIGRATIONS}=require('../src/migration-runner');

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
