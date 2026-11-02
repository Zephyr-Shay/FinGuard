import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {Engine,seed} from '../core.mjs';import {changePersonal,personal,ledger} from '../personal.mjs';
import {draftPlan,approvePlan,cancelPlan,bankView} from '../banking.mjs';
import {savingsView,savingsBalance} from '../savings.mjs';import {budgetSummary,moneyReview,requireMoneyChoice,recordMoneyChoice,budgetDay} from '../budget.mjs';import {requirement} from '../verification.mjs';import {wealthCashflow} from '../wealth-context.mjs';import {createBusinessHandler} from '../server.mjs';
const now=Date.now();
function fixture(){const e=new Engine(seed());e.state.goals=[];const g=changePersonal(e,'goal',{title:'旅行',target:1000000});return {e,s:e.state,g};}
function draft(s,g,cents,kind='save_in'){return draftPlan(s,{title:kind==='save_in'?'存入储蓄':'取回储蓄',steps:[{kind,goal:g.id,cents}]},now);}
function approve(s,p,ack=true){const t=s.banking.plans.find(x=>x.id===p.id),r=requireMoneyChoice(s,t,ack?moneyReview(s,t,now)?.token:undefined,now);recordMoneyChoice(s,t,r,now);t.verificationLevel='red';return approvePlan(s,p.id,p.token,now);}
test('savings moves existing funds, conserves assets and produces one dated receipt even after retry',()=>{
 const {s,g,e}=fixture(),before=s.balance,spent=budgetSummary(s).spent;const p=draft(s,g,50000);assert.equal(s.balance,before);assert.equal(savingsView(s).total,0);
 assert.equal(approve(s,p).status,'completed');assert.equal(s.balance,before-50000);assert.equal(savingsBalance(s,g.id),50000);assert.equal(s.balance+savingsView(s).total,before);assert.equal(personal(e).goals[0].saved,50000);assert.equal(budgetSummary(s).spent,spent);
 approvePlan(s,p.id,p.token,now);assert.equal(s.orders.length,1);const receipt=s.orders[0];assert.equal(receipt.action,'save_in');assert.ok(receipt.time);assert.equal(receipt.savings.after,50000);assert.equal(ledger(e).find(r=>r.id===receipt.id).kind,'internal');assert.equal(ledger(e).find(r=>r.id===receipt.id).direction,'out');
 const out=draft(s,g,20000,'save_out');approve(s,out);assert.equal(s.balance,before-30000);assert.equal(savingsView(s).total,30000);assert.equal(s.balance+savingsView(s).total,before);assert.equal(s.orders[1].savings.after,30000);
});
test('withdrawals cannot use another pot, exceed the saved amount or create money; invalid IDs and manual progress rejected',()=>{
 const {s,g,e}=fixture(),before=s.balance;const other=changePersonal(e,'goal',{title:'应急',target:500000});approve(s,draft(s,g,10000));
 assert.equal(approve(s,draft(s,other,1,'save_out')).status,'paused');assert.equal(approve(s,draft(s,g,10001,'save_out')).status,'paused');assert.equal(s.balance,before-10000);assert.equal(s.orders.length,1);
 assert.throws(()=>draft(s,{id:'foreign'},1),/不存在/);for(const cents of [0,-1,1.5,100000001])assert.throws(()=>draft(s,g,cents));assert.throws(()=>changePersonal(e,'goal',{title:'伪造',target:999999,saved:10000}),/手工/);
});
test('insufficient funds, card loss, limits, missing strong verification and unchosen reserve exception cannot transfer',()=>{
 for(const reason of ['balance','lost','limit','verification','reserve']){const {s,g}=fixture();const p=draft(s,g,50000),t=s.banking.plans[0];if(reason==='balance')s.balance=49999;if(reason==='lost')s.banking.cards[0].status='lost';if(reason==='limit')s.banking.cards[0].limit=49999;
  if(reason==='reserve'){s.personalPlan={reserve:s.balance};assert.throws(()=>approve(s,p,false),/需要你决定/);assert.equal(savingsView(s).total,0);continue;}
  if(reason==='verification'){assert.equal(approvePlan(s,p.id,p.token,now).status,'paused');}else assert.equal(approve(s,p).status,'paused');assert.equal(savingsView(s).total,0);assert.equal(s.orders.length,0);
 }
 const {s,g}=fixture();s.personalPlan={reserve:s.balance};const before=s.balance,p=draft(s,g,50000);assert.equal(requirement(s,s.banking.plans[0]).totp,true);approve(s,p);assert.equal(s.balance,before-50000);assert.equal(s.personalPlan.reserve,before);
});
test('goal edits or pot changes invalidate older confirmations; cancelling and expiry never move funds',()=>{
 const {s,g,e}=fixture(),before=s.balance,p=draft(s,g,10000);changePersonal(e,'goal',{id:g.id,title:'旅行二',target:200000});assert.throws(()=>approve(s,p),/对象或参数/);assert.equal(s.balance,before);
 const a=draft(s,g,10000),b=draft(s,g,10000);approve(s,a);assert.throws(()=>approve(s,b),/对象或参数/);assert.equal(savingsView(s).total,10000);
 const c=draft(s,g,20000);cancelPlan(s,c.id,now);assert.equal(savingsView(s).total,10000);const exp=draft(s,g,20000);assert.throws(()=>approvePlan(s,exp.id,exp.token,now+300001),/过期/);assert.equal(savingsView(s).total,10000);
});
test('old handwritten progress is preserved separately, never credited; funded goals cannot be deleted and receipts survive deletion',()=>{
 const {s,g,e}=fixture();s.goals[0].saved=70000;delete s.goals[0].funding;const before=s.balance;assert.equal(personal(e).goals[0].saved,0);assert.equal(personal(e).goals[0].legacyRecorded,70000);assert.equal(s.balance,before);
 const inPlan=draft(s,g,10000);approve(s,inPlan);assert.equal(s.goals[0].legacyRecorded,70000);assert.throws(()=>changePersonal(e,'goal',{id:g.id,remove:true}),/先取回/);
 // Cancel outstanding authorizations before deleting a zero-balance goal.
 const out=draft(s,g,10000,'save_out');approve(s,out);assert.equal(s.balance,before);changePersonal(e,'goal',{id:g.id,remove:true});assert.equal(s.goals.length,0);assert.equal(savingsView(s).records.length,2);assert.equal(s.orders[0].params.goalTitle,'旅行');assert.equal(savingsView(s).total,0);
});
test('savings are excluded from consumption budgets and available investment cash; the legacy plan binding format remains compatible',()=>{
 const {s,g}=fixture(),before=s.balance;const spent=budgetSummary(s).spent;approve(s,draft(s,g,50000));assert.equal(budgetSummary(s).spent,spent);assert.equal(wealthCashflow(s,30,now).balance,before-50000);
 const original=draftPlan(s,{steps:[{kind:'transfer',recipient:'lin',cents:10000,date:budgetDay(now),reserve:0,includeSubscriptions:false}]},now),t=s.banking.plans.at(-1);
 const {createHash}=requireCrypto();
 function requireCrypto(){return cryptoModule;}
 const expected=createHash('sha256').update(JSON.stringify({id:t.id,steps:t.steps,expires:t.expires,targets:[s.contacts.find(c=>c.id==='lin')]})).digest('hex');assert.equal(t.binding,expected);
 assert.equal(bankView(s).savings.total,50000);
});
import * as cryptoModule from 'node:crypto';

async function apiFixture(t,{authorizePayment}={}){mkdirSync('.test-data',{recursive:true});const folder=mkdtempSync('.test-data/v122-api-');t.after(()=>rmSync(folder,{recursive:true,force:true}));let checked=0;const h=createBusinessHandler({folder,configured:()=>false,authorizePayment:authorizePayment||(async(req,pin,v,otp)=>{checked++;assert.equal(pin,'test-pin');if(v.totp)assert.equal(otp,'test-otp');return ()=>{};})});async function call(url,body){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{url,method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317','content-type':'application/json'}});let code,result;await h(req,{setHeader(){},writeHead(c){code=c;},end(x){result=JSON.parse(x);}});return {code,body:result};}const g=(await call('/api/personal/goal',{title:'应急储蓄',target:100000})).body;return {call,g,checked:()=>checked};}
test('HTTP staged verification does not move funds until final authorization, cannot change the amount, and persists balances',async t=>{
 const {call,g}=await apiFixture(t),before=(await call('/api/state')).body;const p=(await call('/api/banking/plan',{steps:[{kind:'save_in',goal:g.id,cents:12345}]})).body;assert.equal(p.verification.totp,true);
 assert.equal((await call('/api/banking/plans/'+p.id+'/verify-pin',{token:p.token,paymentPin:'test-pin'})).code,200);assert.equal((await call('/api/state')).body.balance,before.balance);
 const url='/api/banking/plans/'+p.id+'/approve';assert.equal((await call(url,{token:p.token,paymentPin:'test-pin',totp:'test-otp',cents:1})).code,400);
 const done=await call(url,{token:p.token,paymentPin:'test-pin',totp:'test-otp'});assert.equal(done.body.status,'completed');assert.equal(done.body.receipts[0].savings.after,12345);
 await call(url,{token:p.token,paymentPin:'test-pin',totp:'test-otp'});const after=(await call('/api/state')).body;assert.equal(after.balance,before.balance-12345);assert.equal(after.personal.savings.total,12345);assert.equal(after.orders.length,before.orders.length+1);
});
test('HTTP reserve choice happens before strong authentication and verification races cannot alter or lose savings',async t=>{
 let release,began;const start=new Promise(r=>began=r);const {call,g}=await apiFixture(t,{authorizePayment:async()=>{began();await new Promise(r=>release=r);return ()=>{};}});
 const before=(await call('/api/state')).body;await call('/api/personal/budget',{month:budgetDay().slice(0,7),budget:0,reserve:before.balance,categoryBudgets:{}});const p=(await call('/api/banking/plan',{steps:[{kind:'save_in',goal:g.id,cents:10000}]})).body;assert.equal(p.moneyReview.requiresChoice,true);
 assert.equal((await call('/api/banking/plans/'+p.id+'/approve',{token:p.token,paymentPin:'test-pin',totp:'test-otp'})).code,409);
 const pending=call('/api/banking/plans/'+p.id+'/approve',{token:p.token,paymentPin:'test-pin',totp:'test-otp',budgetAck:p.moneyReview.token});await start;await call('/api/personal/goal',{id:g.id,title:'新名称',target:100000});release();assert.match((await pending).body.error,/验证期间/);const s=(await call('/api/state')).body;assert.equal(s.balance,before.balance);assert.equal(s.personal.savings.total,0);
});


