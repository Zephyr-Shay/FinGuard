import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {Engine,seed} from '../core.mjs';
import {changePersonal} from '../personal.mjs';
import {budgetSummary,moneyReview,requireMoneyChoice,budgetDay} from '../budget.mjs';
import {wealthCashflow} from '../wealth-context.mjs';
import {createBusinessHandler} from '../server.mjs';
const day=budgetDay(),month=day.slice(0,7);
const plan=(extra={})=>({month,totalBudget:900000,reserve:200000,budget:700000,categoryBudgets:{居住:300000,餐饮:100000,生活:100000,学习:50000,订阅:50000,交通:50000,其他:50000},...extra});

test('one balanced monthly allocation persists an exact sum; consumption and wealth use the net allowance once',()=>{
 const e=new Engine(seed());e.state.bills=[];e.state.orders=[];e.state.subscriptions=[];e.state.expenses=[];const balance=e.state.balance;
 const p=changePersonal(e,'budget',plan());assert.equal(p.totalBudget-p.reserve,Object.values(p.categoryBudgets).reduce((a,b)=>a+b,0));assert.equal(p.budget,700000);assert.equal(e.state.balance,balance);
 const b=budgetSummary(e.state);assert.equal(b.totalBudget,900000);assert.equal(b.budget,700000);assert.equal(b.remaining,700000);assert.equal(b.enabled,true);
 assert.equal(wealthCashflow(e.state,30).budgetRemaining,700000);
 assert.ok(e.state.events.at(-1).time);assert.equal(e.state.events.at(-1).details.after.totalBudget,900000);assert.ok(e.state.events.at(-1).details.before);
});

test('mismatched amounts, negative or overlarge reserve and inconsistent caller cap are rejected atomically',()=>{
 const e=new Engine(seed());changePersonal(e,'budget',plan());const before=structuredClone(e.state);
 for(const p of [plan({reserve:900001}),plan({categoryBudgets:{居住:699999}}),plan({categoryBudgets:{居住:700001}}),plan({budget:900000}),plan({totalBudget:900000.1}),plan({reserve:-1}),plan({totalBudget:200000001}),plan({categoryBudgets:{不存在:700000}})]){
  assert.throws(()=>changePersonal(e,'budget',p));assert.deepEqual(e.state,before);
 }
 // An older client cannot revert a balanced plan to independent, unbalanced caps.
 const oldClient=plan({categoryBudgets:{餐饮:100000}});delete oldClient.totalBudget;
 assert.throws(()=>changePersonal(e,'budget',oldClient),/配平/);assert.deepEqual(e.state,before);
});

test('zero allocation is a real zero allowance and category zero cannot disable a warning',()=>{
 const e=new Engine(seed());e.state.bills=[];e.state.expenses=[];e.state.subscriptions=[];
 changePersonal(e,'budget',plan({totalBudget:200000,budget:0,categoryBudgets:{}}));
 let b=budgetSummary(e.state);assert.equal(b.enabled,true);assert.equal(b.remaining,0);assert.equal(b.near,false);
 const t={id:'test',action:'transfer',params:{cents:1,recipientId:'lin',purpose:'expense',category:'餐饮'}};
 const review=moneyReview(e.state,t);assert.equal(review.requiresChoice,true);assert.equal(review.warnings.find(x=>x.type==='budget').shortfall,1);assert.equal(review.warnings.find(x=>x.type==='category').limit,0);assert.throws(()=>requireMoneyChoice(e.state,t),/需要你决定/);
 e.state.expenses=[{id:'x',status:'actual',date:day,cents:1,category:'餐饮'}];b=budgetSummary(e.state);assert.equal(b.over,1);assert.equal(b.categories.find(c=>c.name==='餐饮').over,1);
 const next=budgetSummary(e.state,'2027-12');assert.equal(next.enabled,false);assert.equal(next.over,0);
});

test('legacy independent budget is preserved until the user explicitly saves the balanced editor',()=>{
 const e=new Engine(seed());const old={month,budget:300000,reserve:100000,categoryBudgets:{餐饮:50000}};e.state.personalPlan=structuredClone(old);
 assert.equal(budgetSummary(e.state).budget,300000);assert.equal(budgetSummary(e.state).totalBudget,null);assert.deepEqual(e.state.personalPlan,old);
 changePersonal(e,'budget',{...old,totalBudget:400000,categoryBudgets:{餐饮:50000,其他:250000}});
 assert.equal(e.state.personalPlan.budget,300000);assert.equal(e.state.personalPlan.totalBudget,400000);
});

test('HTTP cannot save a false sum; rejection leaves budget, balance and history unchanged and valid allocation survives reload',async t=>{
 mkdirSync('.test-data',{recursive:true});const folder=mkdtempSync('.test-data/v121-');t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const handler=()=>createBusinessHandler({folder,configured:()=>false});
 async function call(h,url,body){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{url,method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317','content-type':'application/json'}});let code,result;await h(req,{setHeader(){},writeHead(c){code=c;},end(s){result=JSON.parse(s);}});return {code,body:result};}
 const h=handler(),initial=(await call(h,'/api/state')).body;
 const invalid=await call(h,'/api/personal/budget',plan({categoryBudgets:{居住:100}}));assert.equal(invalid.code,400);assert.match(invalid.body.error,/合计/);
 let s=(await call(h,'/api/state')).body;assert.deepEqual(s.personal.plan,initial.personal.plan);assert.equal(s.balance,initial.balance);
 assert.equal((await call(h,'/api/personal/budget',plan())).code,200);
 s=(await call(handler(),'/api/state')).body;assert.equal(s.personal.plan.totalBudget,900000);assert.equal(s.personal.budget.budget,700000);assert.equal(s.personal.budget.totalBudget,900000);assert.equal(s.balance,initial.balance);assert.equal(s.orders.length,initial.orders.length);
});
