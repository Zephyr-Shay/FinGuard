import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON,requestTimeout} from '../public/request.js';
import {seed} from '../core.mjs';
import {requirement,trustPayees,policyView,day} from '../verification.mjs';
import {verificationNote,pinField} from '../public/security.js';
const now=Date.now(),target=()=>({id:'test',status:'approval',steps:[{kind:'transfer',recipient:'lin',cents:5000,date:day(now),reserve:0,purpose:'transfer'}]});
function simple(){const s=seed();s.securityPolicy={simplify:true,threshold:100000};s.bills=[];s.subscriptions=[];trustPayees(s,target());return s;}
test('ordinary writes and reads have finite deadlines while model generation has a separate budget',()=>{
 assert.equal(requestTimeout('/api/banking/plans/id/approve',true),12000);assert.equal(requestTimeout('/api/state'),8000);assert.equal(requestTimeout('/api/plan',true),60000);assert.equal(requestTimeout('/api/market?refresh=1'),60000);assert.equal(requestTimeout('/api/funding-assistant/reply',true),60000);
});
test('hung write is aborted once and never automatically retried',async()=>{
 let calls=0,signal;await assert.rejects(()=>requestJSON('/api/test',{token:'one'},{timeoutMs:15,fetcher:async(p,o)=>{calls++;signal=o.signal;return new Promise(()=>{});}}),e=>e.timeout&&e.status===undefined);assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('deadline also bounds a response whose headers arrive but JSON body stalls',async()=>{
 await assert.rejects(()=>requestJSON('/api/state',undefined,{timeoutMs:15,fetcher:async()=>({ok:true,json:()=>new Promise(()=>{})})}),e=>e.code==='REQUEST_TIMEOUT');
});
test('transport forwards identity and preserves HTTP failure instead of claiming success',async()=>{
 let opts;assert.deepEqual(await requestJSON('/api/test',{token:'one'},{userId:'test-user',fetcher:async(p,o)=>{opts=o;return {ok:true,json:async()=>({status:'completed'})};}}),{status:'completed'});assert.equal(opts.headers['X-FinGuard-User'],'test-user');assert.deepEqual(JSON.parse(opts.body),{token:'one'});
 await assert.rejects(()=>requestJSON('/api/test',{}, {fetcher:async()=>({ok:false,status:409,json:async()=>({error:'状态已变化'})})}),e=>e.status===409&&e.message==='状态已变化');
});
test('eligible password-free transfer needs no PIN or OTP and shows the actual remaining daily allowance',()=>{
 const s=simple(),v=requirement(s,target(),now);assert.equal(v.pin,false);assert.equal(v.totp,false);assert.equal(v.simplify,true);assert.equal(v.remaining,100000);assert.doesNotMatch(pinField(v),/id="payment-pin"|id="verification-otp"/);assert.match(verificationNote(v),/本笔免输支付密码/);
});
test('enabled waiver still explains a new payee, daily allowance or unresolved operation',()=>{
 const s=simple();s.verifiedPayees=[];let v=requirement(s,target(),now);assert.equal(v.pin,true);assert.match(verificationNote(v),/收款人尚未通过强验证/);assert.match(verificationNote(v),/暂不适用小额免密/);
 trustPayees(s,target());s.securityPolicy.threshold=1000;v=requirement(s,target(),now);assert.equal(v.totp,true);assert.match(verificationNote(v),/超过小额额度/);
 s.securityPolicy.threshold=100000;s.banking={plans:[{id:'old',status:'paused'}]};v=requirement(s,target(),now);assert.equal(v.pin,true);assert.match(verificationNote(v),/暂停操作/);
});
test('usage counts all recipients, reservations and archived totals while excluding the current plan',()=>{
 const s=simple(),date=day(now);s.securityDailyTotals={[date]:1000};s.orders=[{action:'transfer',params:{cents:2000},time:new Date(now).toISOString()}];s.banking={plans:[{id:'waiting',status:'scheduled',steps:[{kind:'transfer',date,cents:3000}],runs:[{status:'waiting'}]}]};assert.equal(policyView(s,now).used,6000);assert.equal(policyView(s,now).remaining,94000);const t={...target(),id:'waiting'};assert.equal(requirement(s,t,now).used,3000);
});
