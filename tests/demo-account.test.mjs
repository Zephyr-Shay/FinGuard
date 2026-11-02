import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {Accounts} from '../accounts.mjs';
import {createTester,demoLoginEnabled} from '../demo-account.mjs';
import {createHandler} from '../server.mjs';
function fixture(t){const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'demo-login-')),a=new Accounts(folder),closers=[];t.after(()=>{for(const close of closers)close();a.close();assert.ok(folder.startsWith(base+sep));rmSync(folder,{recursive:true,force:true});});return {folder,a,closers};}
async function call(h,path,body,cookie=''){
 const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{url:path,method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317','content-type':'application/json',cookie}});
 let status,raw;const headers={};await h(req,{setHeader(k,v){headers[k]=v},writeHead(s,v){status=s;Object.assign(headers,v)},end(v){raw=v}});return {status,body:JSON.parse(raw),headers};
}
test('explicit tester provisioning is idempotent, salted and does not weaken regular password creation',async t=>{
 const {a}=fixture(t);assert.equal(demoLoginEnabled(a.db),false);assert.equal(createTester(a.db).created,true);assert.equal(createTester(a.db).created,false);const row=a.db.prepare('SELECT * FROM users WHERE username=?').get('tester');assert.notEqual(row.hash,'tester');assert.ok(row.salt);assert.equal((await a.login('tester','tester')).user.id,row.id);assert.equal(demoLoginEnabled(a.db),true);await assert.rejects(()=>a.create('ordinary','ordinary'));await assert.rejects(()=>a.create('another','short'));
});
test('demo helper cannot overwrite an existing tester identity or its strong password',async t=>{
 const {a}=fixture(t),u=await a.create('tester','Tester-password-123');assert.throws(()=>createTester(a.db),/不会覆盖/);assert.equal((await a.login('tester','Tester-password-123')).user.id,u.id);await assert.rejects(()=>a.login('tester','tester'));assert.equal(demoLoginEnabled(a.db),false);
});
test('changed demo credentials invalidate the public hint without being reset by re-provisioning',async t=>{
 const {a}=fixture(t);createTester(a.db);const l=await a.login('tester','tester');await a.changePassword(l.token,'tester','Changed-demo-password-123');assert.equal(demoLoginEnabled(a.db),false);assert.throws(()=>createTester(a.db),/不会覆盖/);await assert.rejects(()=>a.login('tester','tester'));await a.login('tester','Changed-demo-password-123');
});
test('HTTP demo login uses normal sessions, keeps accounts isolated and exposes no account-creation route',async t=>{
 const {folder,a,closers}=fixture(t);createTester(a.db);await a.create('ordinary','Ordinary-password-123');const h=createHandler({folder,scheduler:false,configured:()=>false});closers.push(()=>h.close());
 const health=await call(h,'/api/health');assert.equal(health.body.version,'1.0.0');assert.equal(health.body.demoLogin,true);
 const d=await call(h,'/api/auth/login',{username:'tester',password:'tester'});assert.equal(d.status,200);assert.match(d.headers['Set-Cookie'],/HttpOnly/);const cookie=d.headers['Set-Cookie'].split(';')[0],state=await call(h,'/api/state',undefined,cookie);assert.equal(state.body.version,'1.0.0');assert.equal(state.body.user.username,'tester');assert.equal(a.paymentStatus(state.body.user.id),false);assert.equal(a.mfaStatus(state.body.user.id),false);
 const other=await call(h,'/api/auth/login',{username:'ordinary',password:'Ordinary-password-123'});assert.notEqual(other.body.user.id,d.body.user.id);assert.equal((await call(h,'/api/auth/register',{username:'forged',password:'forged'})).status,404);assert.equal((await call(h,'/api/auth/demo',{})).status,404);
});
test('demo CLI requires its explicit opt-in before touching a data directory',t=>{
 const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'demo-cli-'));t.after(()=>{assert.ok(folder.startsWith(base+sep));rmSync(folder,{recursive:true,force:true});});const r=spawnSync(process.execPath,['tools/provision-demo.mjs'],{env:{...process.env,FINGUARD_DATA_DIR:folder},encoding:'utf8'});assert.notEqual(r.status,0);assert.deepEqual(readdirSync(folder),[]);
});
