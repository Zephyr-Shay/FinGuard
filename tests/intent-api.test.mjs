import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {resolve,join,sep} from 'node:path';
import {createBusinessHandler} from '../server.mjs';import {plannerError} from '../planner-errors.mjs';
function fixture(t,planner){const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'intent-'));t.after(()=>{assert.ok(folder.startsWith(base+sep));rmSync(folder,{recursive:true,force:true});});return createBusinessHandler({folder,planner,configured:()=>false});}
async function call(h,url,body){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{method:body===undefined?'GET':'POST',url,headers:{host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317','content-type':'application/json'}});let status,output;await h(req,{writeHead(s){status=s;},setHeader(){},end(x){output=x;}});return {status,body:JSON.parse(output)};}
test('业务接口在模型编造金额或误路由多步计划时保持追问，无确认凭证与订单',async t=>{
 for(const action of ['transfer','banking']){
  const h=fixture(t,async()=>({mode:'model',plan:action==='transfer'?{action,recipient:'lin',cents:30000}:{action,steps:[{kind:'transfer',recipient:'lin',cents:30000}]}}));
  const r=await call(h,'/api/plan',{message:'给林晓转账，金额你看着办'});assert.equal(r.status,200);assert.equal(r.body.status,'collecting');assert.equal(r.body.token,undefined);
  const state=(await call(h,'/api/state')).body;assert.equal(state.balance,1856000);assert.equal(state.orders.length,0);assert.equal(state.banking?.plans?.length||0,0);
 }
});
test('追问会话可接续用户的金额，已结束任务中的旧金额不能补入新需求',async t=>{
 let n=0;const h=fixture(t,async()=>({mode:'model',plan:++n===1?{action:'collect',question:'请选择收款人'}:{action:'transfer',recipient:'lin',cents:20000}}));
 const first=(await call(h,'/api/plan',{message:'给我爸转两百元'})).body;
 const next=(await call(h,'/api/plan',{message:'林晓',previousId:first.id})).body;assert.equal(next.status,'approval');
 await call(h,'/api/tasks/'+next.id+'/reject',{});
 const stale=(await call(h,'/api/plan',{message:'林晓',previousId:next.id})).body;assert.equal(stale.status,'collecting');assert.equal(stale.token,undefined);assert.equal((await call(h,'/api/state')).body.orders.length,0);
});
for(const [code,status]of [['AI_PLAN_INVALID',502],['AI_REPLY_INCOMPLETE',502],['AI_SERVICE_TIMEOUT',504],['AI_SERVICE_UNAVAILABLE',503],['AI_BUSY',429]])test('业务接口返回明确错误码与恢复提示：'+code,async t=>{
 const h=fixture(t,async()=>{throw plannerError(code,'INTERNAL_FIXTURE_DETAIL');});const r=await call(h,'/api/plan',{message:'给林晓转300元'});
 assert.equal(r.status,status);assert.equal(r.body.code,code);assert.match(r.body.error,/未执行/);assert.doesNotMatch(r.body.error,/INTERNAL_FIXTURE_DETAIL|模型|请求失败/);assert.equal((await call(h,'/api/state')).body.orders.length,0);
});
test('多步接口拒绝金额对调、复用与漏项，不创建业务计划或确认凭证',async t=>{
 for(const pairs of [[['lin',50000],['chen-a',30000]],[['lin',50000],['chen-a',50000]],[['lin',30000]]]){
  const h=fixture(t,async()=>({mode:'model',plan:{action:'banking',steps:pairs.map(([recipient,cents])=>({kind:'transfer',recipient,cents,date:new Date(Date.now()+86400000).toISOString().slice(0,10),reserve:0}))}}));
  const r=await call(h,'/api/plan',{message:'给林晓转300元，给陈晨转500元'});assert.equal(r.status,200);assert.equal(r.body.status,'collecting');assert.equal(r.body.token,undefined);assert.equal(r.body.bankingPlan,undefined);
  const state=(await call(h,'/api/state')).body;assert.equal(state.balance,1856000);assert.equal(state.orders.length,0);assert.equal(state.banking?.plans?.length||0,0);
 }
});
test('多步接口接受正确的逐笔重排，但仍停在待确认且不写交易',async t=>{
 const h=fixture(t,async()=>({mode:'model',plan:{action:'banking',steps:[['chen-a',50000],['lin',30000]].map(([recipient,cents])=>({kind:'transfer',recipient,cents,date:new Date(Date.now()+86400000).toISOString().slice(0,10),reserve:0}))}}));
 const r=await call(h,'/api/plan',{message:'给林晓转300元，给陈晨转500元'});assert.equal(r.body.bankingPlan.status,'approval');assert.deepEqual(r.body.bankingPlan.steps.map(x=>[x.recipient,x.cents]),[['chen-a',50000],['lin',30000]]);assert.equal((await call(h,'/api/state')).body.orders.length,0);
});
