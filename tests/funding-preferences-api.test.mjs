import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {Readable} from 'node:stream';
import {Accounts} from '../accounts.mjs';
import {createHandler} from '../server.mjs';
test('Preference and observation HTTP endpoints persist confirmed choices and isolate accounts',async t=>{
 mkdirSync('.test-data',{recursive:true});const folder=mkdtempSync('.test-data/preferences125-'),a=new Accounts(folder);
 await a.create('pref_owner','Fixture-Owner-928!');await a.create('pref_other','Fixture-Other-928!');const owner=await a.login('pref_owner','Fixture-Owner-928!'),other=await a.login('pref_other','Fixture-Other-928!');
 let h=createHandler({folder,scheduler:false,configured:()=>false,fundingModel:async()=>JSON.stringify({answer:'只整理生活费',patch:{reserve:200000}})});t.after(()=>{h.close();a.close();rmSync(folder,{recursive:true,force:true});});
 async function call(path,body,identity=owner){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{method:body===undefined?'GET':'POST',url:path,headers:{host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317','content-type':'application/json',cookie:identity?'fg_session='+identity.token:'',...(identity?{'x-finguard-user':identity.user.id}:{})}});let code,value;await h(req,{setHeader(){},writeHead(c){code=c;},end(s){value=JSON.parse(s);}});return {code,value};}
 assert.equal((await call('/api/cashflow',undefined,null)).code,401);assert.equal((await call('/api/funding-assistant/preference',{action:'save'},null)).code,401);
 let c=(await call('/api/funding-assistant/start',{})).value.chat;c=(await call('/api/funding-assistant/reply',{id:c.id,revision:c.revision,message:'留2000元生活费'})).value.chat;
 const input={id:c.id,revision:c.revision,action:'save',preferenceRevision:0,confirmed:true};assert.equal((await call('/api/funding-assistant/preference',{...input,confirmed:false})).code,400);assert.equal((await call('/api/funding-assistant/preference',{...input,reserve:1})).code,400);
 assert.equal((await call('/api/funding-assistant/preference',input)).value.preferences.saved.reserveCents,200000);assert.equal((await call('/api/funding-assistant',undefined,other)).value.preferences.saved,null);
 h.close();h=createHandler({folder,scheduler:false,configured:()=>false});const persisted=(await call('/api/funding-assistant')).value;assert.equal(persisted.preferences.saved.reserveCents,200000);const fresh=(await call('/api/funding-assistant/start',{})).value.chat;
 assert.equal((await call('/api/funding-assistant/use',{id:fresh.id,revision:0,source:'saved',value:1,preferenceRevision:1})).code,400);
 assert.equal((await call('/api/funding-assistant/use',{id:fresh.id,revision:0,source:'saved',value:200000,preferenceRevision:1})).value.chat.candidate.reserve,200000);
 assert.equal((await call('/api/funding-assistant/preference',{action:'forget',confirmed:true,preferenceRevision:1})).value.preferences.saved,null);assert.equal((await call('/api/funding-assistant',undefined,other)).value.chat,null);
 assert.equal((await call('/api/state')).value.orders.length,0);assert.ok((await call('/api/cashflow')).value.checkedAt);assert.ok((await call('/api/activity')).value.rows.some(x=>x.label==='确认资金安排偏好'));
});
