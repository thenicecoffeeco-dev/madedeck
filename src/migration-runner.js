'use strict';

const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

const MIGRATIONS=Object.freeze([
  '002_saas_foundation.sql',
  '003_swarm_power_console.sql',
  '003a_reconcile_legacy_monetization.sql',
  '004_billing_entitlements.sql',
  '005_modular_action_commerce.sql',
  '006_system_communications.sql',
  '007_revenue_dialer_and_storefront.sql',
  '008_scoped_feature_controls.sql',
  '009_runtime_gap_closure.sql',
  '010_saas_owner_command_center.sql',
  '011_account_connection_backbone.sql',
  '012_high_integrity_identity_access.sql'
]);

function checksum(text){return crypto.createHash('sha256').update(text).digest('hex');}

function splitSql(source){
  const statements=[];
  let current='',quote=null,lineComment=false,blockComment=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(lineComment){if(ch==='\n'){lineComment=false;current+=ch;}continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(!quote&&ch==='-'&&next==='-'&&(i===0||/\s/.test(source[i-1]))){lineComment=true;i++;continue;}
    if(!quote&&ch==='#'){lineComment=true;continue;}
    if(!quote&&ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(quote){
      current+=ch;
      if(ch==='\\'){if(i+1<source.length)current+=source[++i];continue;}
      if(ch===quote){
        if(source[i+1]===quote){current+=source[++i];continue;}
        quote=null;
      }
      continue;
    }
    if(ch==="'"||ch==='"`'||ch==='"'){quote=ch;current+=ch;continue;}
    if(ch===';'){if(current.trim())statements.push(current.trim());current='';continue;}
    current+=ch;
  }
  if(current.trim())statements.push(current.trim());
  return statements;
}

async function tableExists(connection,name){
  const [rows]=await connection.execute(
    'SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1',
    [name]
  );
  return rows.length>0;
}

async function ensureLedger(connection){
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_key VARCHAR(100) NOT NULL,
    checksum CHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    last_statement INT UNSIGNED NOT NULL DEFAULT 0,
    error_text TEXT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (migration_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function baselineFoundation(connection){
  const markers=['users','stores','products','orders','offers','subscriptions','audit_log'];
  const checks=await Promise.all(markers.map(name=>tableExists(connection,name)));
  if(!checks.every(Boolean))return false;
  await connection.execute(
    `INSERT IGNORE INTO schema_migrations(migration_key,checksum,status,last_statement,completed_at)
     VALUES('002_saas_foundation.sql','legacy-full-schema','completed',0,NOW())`
  );
  return true;
}

async function status(connection,migrationsDir){
  const [rows]=await connection.query('SELECT migration_key,checksum,status,last_statement,error_text,completed_at FROM schema_migrations');
  const byKey=new Map(rows.map(row=>[row.migration_key,row]));
  return MIGRATIONS.map(key=>{
    const file=fs.readFileSync(path.join(migrationsDir,key),'utf8');
    const row=byKey.get(key);
    return {key,checksum:checksum(file),status:row?.status||'pending',last_statement:Number(row?.last_statement||0),checksum_match:!row||row.checksum==='legacy-full-schema'||row.checksum===checksum(file),error:row?.error_text||null};
  });
}

async function applyOne(connection,migrationsDir,key){
  const file=fs.readFileSync(path.join(migrationsDir,key),'utf8');
  const hash=checksum(file),statements=splitSql(file);
  const [[existing]]=await connection.execute('SELECT * FROM schema_migrations WHERE migration_key=? LIMIT 1',[key]);
  if(existing?.status==='completed'){
    if(existing.checksum!=='legacy-full-schema'&&existing.checksum!==hash)throw new Error(`migration_checksum_changed:${key}`);
    return {key,status:'already_completed',statements:statements.length};
  }
  const start=Number(existing?.last_statement||0);
  await connection.execute(
    `INSERT INTO schema_migrations(migration_key,checksum,status,last_statement,error_text)
     VALUES(?,?,'running',?,NULL)
     ON DUPLICATE KEY UPDATE checksum=VALUES(checksum),status='running',error_text=NULL`,
    [key,hash,start]
  );
  for(let index=start;index<statements.length;index++){
    try{
      await connection.query(statements[index]);
      await connection.execute('UPDATE schema_migrations SET last_statement=? WHERE migration_key=?',[index+1,key]);
    }catch(error){
      await connection.execute("UPDATE schema_migrations SET status='failed',error_text=? WHERE migration_key=?",[String(error.message||error).slice(0,4000),key]);
      const wrapped=new Error(`migration_failed:${key}:statement_${index+1}:${error.message}`);
      wrapped.cause=error;
      throw wrapped;
    }
  }
  await connection.execute("UPDATE schema_migrations SET status='completed',completed_at=NOW(),error_text=NULL WHERE migration_key=?",[key]);
  return {key,status:'completed',statements:statements.length};
}

async function runConfiguredMigrations({db,mode='check',migrationsDir=path.join(__dirname,'../db/migrations')}){
  const normalized=String(mode||'check').toLowerCase();
  if(!['off','check','apply'].includes(normalized))throw new Error('invalid_DB_MIGRATION_MODE');
  if(normalized==='off')return {mode:'off',migrations:[]};
  const connection=await db.getConnection();
  try{
    await ensureLedger(connection);
    await baselineFoundation(connection);
    const before=await status(connection,migrationsDir);
    const unsafe=before.filter(item=>item.status==='completed'&&!item.checksum_match);
    if(unsafe.length)throw new Error(`migration_checksum_mismatch:${unsafe.map(x=>x.key).join(',')}`);
    if(normalized==='check')return {mode:'check',ready:!before.some(x=>x.status==='failed'),migrations:before};
    const results=[];
    for(const key of MIGRATIONS)results.push(await applyOne(connection,migrationsDir,key));
    return {mode:'apply',ready:true,results,migrations:await status(connection,migrationsDir)};
  }finally{connection.release();}
}

module.exports={MIGRATIONS,splitSql,checksum,runConfiguredMigrations};
