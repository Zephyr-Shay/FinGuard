import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {StateStore} from '../state-store.mjs';
import {AuditLedger,payloadHash} from '../audit.mjs';
import {createBusinessHandler} from '../server.mjs';
import {seed} from '../core.mjs';
function directory(t){const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'durable-'));t.after(()=>{assert.ok(folder.startsWith(base));rmSync(folder,{recursive:true,force:true});});return folder;}
const initial=()=>({balance:1000,orders:[],receipts:[],tasks:[]});

test('R05: failure while saving the audit entry rolls back balance, orders, receipts and revision together',t=>{
 const folder=directory(t),db=new DatabaseSync(join(folder,'accounts.sqlite'));const audit=new AuditLedger(db,folder),store=new StateStore(folder,{db,audit,owner:'alice'});store.load(initial);
 db.exec("CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON audit_chain BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");
 assert.throws(()=>store.commit(0,()=>({state:{balance:500,orders:[{id:'one'}],receipts:[{id:'one'}],tasks:[{status:'done'}]}})),/fixture write failure/);
 assert.deepEqual(store.read(),{revision:0,state:initial()});assert.equal(audit.verify().entries,1);db.close();
});

test('R05: independent store instances cannot overwrite a newer transaction or execute a stale action',t=>{
 const folder=directory(t),a=new StateStore(folder),b=new StateStore(folder);a.load(initial);const stale=b.read();a.commit(0,()=>({state:{...initial(),balance:900}}));let executed=false;
 assert.throws(()=>b.commit(stale.revision,()=>{executed=true;return {state:initial()};}),e=>e.status===409);assert.equal(executed,false);assert.equal(b.read().state.balance,900);
});

test('R05: legacy JSON migrates once without altering its bytes; later changes to the legacy file cannot replace committed state',t=>{
 const folder=directory(t),file=join(folder,'state.json');writeFileSync(file,JSON.stringify(seed()));const original=readFileSync(file);createBusinessHandler({folder,configured:()=>false});const store=new StateStore(folder),first=store.read();assert.deepEqual(readFileSync(file),original);
 writeFileSync(file,JSON.stringify({...seed(),balance:1}));createBusinessHandler({folder,configured:()=>false});assert.equal(store.read().state.balance,first.state.balance);
});

test('R05: a corrupt legacy file is rejected and never silently replaced by a new demo account',t=>{
 const folder=directory(t),file=join(folder,'state.json');writeFileSync(file,'{broken');assert.throws(()=>createBusinessHandler({folder,configured:()=>false}));assert.equal(readFileSync(file,'utf8'),'{broken');const db=new DatabaseSync(join(folder,'business.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM business_state').get().n,0);}finally{db.close();}
});

test('R05: killing a process inside a transaction leaves the last complete balance/order/receipt state recoverable',async t=>{
 const folder=directory(t),store=new StateStore(folder);store.load(initial);const marker=join(folder,'ready');
 const source=`import {DatabaseSync} from 'node:sqlite';import {writeFileSync} from 'node:fs';import {StateStore} from './state-store.mjs';import {AuditLedger} from './audit.mjs';const folder=process.argv[1],db=new DatabaseSync(folder+'/business.sqlite');db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');const audit=new AuditLedger(db,folder),store=new StateStore(folder,{db,audit});db.function('pause_before_write',()=>{writeFileSync(folder+'/ready','ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000);return 0;});db.exec('CREATE TEMP TRIGGER pause BEFORE UPDATE ON business_state BEGIN SELECT pause_before_write(); END;');store.commit(0,()=>({state:{balance:500,orders:[{id:'one'}],receipts:[{id:'one'}],tasks:[{status:'done'}]}}));`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,folder],{cwd:resolve('.'),stdio:['ignore','ignore','pipe'],windowsHide:true});let stderr='';child.stderr.on('data',b=>stderr+=b);const exited=once(child,'exit');t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const until=Date.now()+10000;while(!existsSync(marker)&&Date.now()<until&&child.exitCode===null)await new Promise(r=>setTimeout(r,20));assert.ok(existsSync(marker),stderr||'child did not enter transaction');child.kill('SIGKILL');await exited;
 assert.deepEqual(new StateStore(folder).read(),{revision:0,state:initial()});
});

test('R06: altered or deleted state cannot pass integrity checks or silently initialize a replacement account',t=>{
 const folder=directory(t),store=new StateStore(folder);store.load(initial);const db=new DatabaseSync(join(folder,'business.sqlite')),payload=JSON.stringify({...initial(),balance:99999});try{db.prepare('UPDATE business_state SET payload=?,hash=?').run(payload,payloadHash(payload));}finally{db.close();}assert.throws(()=>store.read(),/完整性/);
 const missing=directory(t),other=new StateStore(missing);other.load(initial);const erased=new DatabaseSync(join(missing,'business.sqlite'));try{erased.exec('DELETE FROM business_state');}finally{erased.close();}let initialized=false;assert.throws(()=>new StateStore(missing).load(()=>{initialized=true;return initial();}),/记录缺失/);assert.equal(initialized,false);
});

test('R06: edits, middle deletion and tail deletion in the audit chain are detected',t=>{
 for(const change of ["UPDATE audit_chain SET details='{}' WHERE seq=1","DELETE FROM audit_chain WHERE seq=1","DELETE FROM audit_chain WHERE seq=2"]){const folder=join(directory(t),'case');mkdirSync(folder);const db=new DatabaseSync(join(folder,'audit.sqlite'));try{const audit=new AuditLedger(db,folder);db.exec('BEGIN');audit.append('alice','fixture',{date:'2026-11-01'});audit.append('alice','fixture',{date:'2026-11-02'});db.exec('COMMIT');assert.equal(audit.verify().entries,2);db.exec(change);assert.throws(()=>audit.verify(),/完整性/);}finally{db.close();}}
});
