import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {scryptSync} from 'node:crypto';
import {Accounts} from '../accounts.mjs';
test('R02: insecure provisioning rejected; offline remediation preserves IDs and unrelated sessions',async()=>{
 const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'admin-'));let a;
 try{a=new Accounts(folder);const old=await a.create('testone','Old-password-123');await a.create('otheruser','Other-password-123');
 const oldSession=await a.login('testone','Old-password-123'),otherSession=await a.login('otheruser','Other-password-123');
 const run=(...args)=>spawnSync(process.execPath,['tools/account-update.mjs',...args],{env:{...process.env,FINGUARD_DATA_DIR:folder},encoding:'utf8'});
 const before=a.db.prepare('SELECT hash FROM users WHERE id=?').get(old.id).hash;
 assert.notEqual(run('--same-as-name','testone').status,0);assert.equal(a.db.prepare('SELECT hash FROM users WHERE id=?').get(old.id).hash,before);
 // Emulate legacy credentials created by the removed administrator tool.
 const row=a.db.prepare('SELECT salt FROM users WHERE id=?').get(old.id);
 a.db.prepare('UPDATE users SET hash=? WHERE id=?').run(scryptSync('testone',row.salt,64).toString('hex'),old.id);
 assert.equal(JSON.parse(run('--check-weak').stdout).weak,1);
 const r=run('--reset-weak');assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.changed,1);
 assert.equal(a.user(oldSession.token),null);assert.equal(a.user(otherSession.token).username,'otheruser');
 const password=readFileSync(result.credentialsFile,'utf8').split('\n').find(s=>s.startsWith('testone\t')).split('\t')[1];
 assert.ok(password.length>=24);assert.ok(!r.stdout.includes(password));assert.equal((await a.login('testone',password)).user.id,old.id);
 await assert.rejects(a.login('testone','testone'));assert.equal(JSON.parse(run('--check-weak').stdout).weak,0);assert.equal(JSON.parse(run('--reset-weak').stdout).changed,0);
 }finally{a?.close();assert.ok(folder.startsWith(base));rmSync(folder,{recursive:true,force:true});}
});
