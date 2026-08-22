const crypto=require('crypto');
const mysql=require('mysql2/promise');
let pool;
function cfg(){if(process.env.DATABASE_URL)return process.env.DATABASE_URL;return {host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,port:Number(process.env.DB_PORT||3306),waitForConnections:true,connectionLimit:10};}
function db(){if(!pool)pool=mysql.createPool(cfg());return pool;}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){const hash=crypto.scryptSync(password,salt,64).toString('hex');return {salt,hash};}
function verifyPassword(password,salt,expected){if(!salt||!expected)return false;const actual=crypto.scryptSync(password,salt,64);const exp=Buffer.from(expected,'hex');return actual.length===exp.length&&crypto.timingSafeEqual(actual,exp);}
async function seedUser(email,password,role){if(!email||!password)return;const {salt,hash}=hashPassword(password);const name=role==='platform_admin'?'MadeDeck Admin':'Demo Merchant';await db().execute(`INSERT INTO users(name,email,password_salt,password_hash,role,status) VALUES(?,?,?,?,?,'active') ON DUPLICATE KEY UPDATE password_salt=VALUES(password_salt),password_hash=VALUES(password_hash),role=VALUES(role),status='active'`,[name,email.toLowerCase(),salt,hash,role]);}
module.exports={db,hashPassword,verifyPassword,seedUser};
