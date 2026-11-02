// Administrator-only, offline tool. Passwords are never accepted on argv.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual} from 'node:crypto';
import {existsSync,chmodSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const [flag,...names]=process.argv.slice(2);
if(!['--check-weak','--reset-weak','--reset-random'].includes(flag)||
 (flag==='--reset-random'?(!names.length||names.length>20||new Set(names).size!==names.length||names.some(n=>! /^[a-z0-9_]{3,32}$/.test(n))):names.length))throw Error('Usage: node tools/account-update.mjs --check-weak | --reset-weak | --reset-random username ...');
const folder=resolve(process.env.FINGUARD_DATA_DIR||'.data'),file=join(folder,'accounts.sqlite');
if(!existsSync(file))throw Error('Existing accounts.sqlite not found; no database created.');
const db=new DatabaseSync(file,{readOnly:flag==='--check-weak'});db.exec('PRAGMA busy_timeout=5000');
try{
 const weak=()=>db.prepare('SELECT id,username,salt,hash FROM users').all().filter(u=>timingSafeEqual(scryptSync(u.username,u.salt,64),Buffer.from(u.hash,'hex')));
 if(flag==='--check-weak')console.log(JSON.stringify({checked:db.prepare('SELECT count(*) AS n FROM users').get().n,weak:weak().length}));
 else{
  const targets=flag==='--reset-weak'?weak():names.map(username=>db.prepare('SELECT * FROM users WHERE username=?').get(username)||{id:randomUUID(),username});
  if(!targets.length)console.log(JSON.stringify({changed:0}));
  else{
   const stamp=Date.now()+'-'+randomBytes(3).toString('hex'),backup=join(folder,'accounts-before-update-'+stamp+'.sqlite'),output=join(folder,'private-credentials-'+stamp+'.txt');
   db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);
   const rows=targets.map(u=>{const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');return {...u,password,salt,hash:scryptSync(password,salt,64).toString('hex')};});
   // Fail before changing credentials if the private delivery list cannot be written.
   writeFileSync(output,'FinGuard 管理员私有初始密码清单；逐人分发，勿公开。\n'+rows.map(u=>u.username+'\t'+u.password).join('\n')+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});chmodSync(output,0o600);
   db.exec('BEGIN IMMEDIATE');
   try{for(const u of rows){db.prepare('INSERT INTO users(id,username,salt,hash) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,hash=excluded.hash').run(u.id,u.username,u.salt,u.hash);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);db.prepare('DELETE FROM attempts WHERE key=?').run('u:'+u.username);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   console.log(JSON.stringify({changed:rows.length,credentialsFile:output,backupSaved:true}));
  }
 }
}finally{db.close();}
