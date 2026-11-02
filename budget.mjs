import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const budgetCategories=['居住','餐饮','生活','学习','订阅','交通','其他'];
export const budgetDay=(now=Date.now())=>new Date(now+28800000).toISOString().slice(0,10);
export function transferUse(input={},override=null){
 const value=override||input,purpose=value.purpose??'transfer';
 if(!['transfer','internal','expense'].includes(purpose))throw Error('请选择资金划转、本人账户互转或消费付款');
 if(purpose==='expense'&&!budgetCategories.includes(value.category))throw Error('消费付款需要选择有效消费分类');
 return {purpose,category:purpose==='expense'?value.category:purpose==='internal'?'账户互转':'转账'};
}
export function orderUse(s,o){return transferUse(o.params||{},s.transferUses?.[o.id]);}
export function spendingRows(s){
 const bills=(s.bills||[]).map(x=>({id:x.id,date:x.date,cents:x.cents,category:x.category,title:x.merchant,source:'bill'}));
 const transfers=(s.orders||[]).filter(o=>o.action==='transfer'&&o.status==='success').flatMap(o=>{const use=orderUse(s,o);return use.purpose==='expense'?[{id:o.id,date:budgetDay(Date.parse(o.time)),cents:o.params.cents,category:use.category,title:'转账消费付款',source:'order'}]:[];});
 const originals=new Set([...bills,...transfers].map(x=>x.id));
 const manual=(s.expenses||[]).filter(x=>x.status==='actual'&&!x.linkedId).map(x=>({id:x.id,date:x.date,cents:x.cents,category:x.category,title:x.title,source:'manual'}));
 return [...bills,...transfers,...manual].filter(x=>Number.isSafeInteger(x.cents)&&x.cents>0);
}
function pendingExpenses(s,excludeId){return [...(s.expenses||[]).filter(x=>x.status==='planned'&&x.id!==excludeId).map(x=>({id:x.id,date:x.date,cents:x.cents,category:x.category})),...(s.banking?.plans||[]).filter(p=>p.id!==excludeId&&p.status==='scheduled').flatMap(p=>p.steps.flatMap((x,i)=>x.kind==='transfer'&&x.purpose==='expense'&&p.runs[i]?.status==='waiting'?[{id:p.id+':'+i,date:x.date,cents:x.cents,category:x.category}]:[]))];}
export function budgetSummary(s,month=s.personalPlan?.month||budgetDay().slice(0,7),now=Date.now()){
 const plan=s.personalPlan||{},rows=spendingRows(s).filter(x=>x.date?.startsWith(month)),spent=rows.reduce((n,x)=>n+x.cents,0),limit=plan.month===month?plan.budget||0:0,enabled=plan.month===month&&(plan.allocationMode==='balanced'||limit>0);
 const planned=pendingExpenses(s).filter(x=>x.date.startsWith(month)).reduce((n,x)=>n+x.cents,0);
 const categories=budgetCategories.map(name=>{const used=rows.filter(x=>x.category===name).reduce((n,x)=>n+x.cents,0),cap=plan.month===month?plan.categoryBudgets?.[name]||0:0;const configured=plan.month===month&&(plan.allocationMode==='balanced'||cap>0);return {name,spent:used,budget:cap,enabled:configured,over:configured?Math.max(0,used-cap):0,near:Boolean(configured&&used>0&&used>=cap*.8)};});
 return {month,enabled,totalBudget:plan.month===month&&plan.allocationMode==='balanced'?plan.totalBudget:null,currentMonth:budgetDay(now).slice(0,7),budget:limit,spent,planned,forecast:spent+planned,forecastOver:enabled?Math.max(0,spent+planned-limit):0,remaining:enabled?Math.max(0,limit-spent):null,over:enabled?Math.max(0,spent-limit):0,near:Boolean(enabled&&spent>0&&spent>=limit*.8),categories,reserve:s.personalPlan?.reserve||0,balance:s.balance,belowReserve:Math.max(0,(s.personalPlan?.reserve||0)-s.balance),scope:'模拟账户已记录的消费：样例账单、实际开销及明确标为消费的转账。本人互转、未分类转出、理财申购不计消费；导入账户单独查看。'};
}
function targetSteps(target,now){return target.steps?.[0]?.kind?target.steps:[{kind:target.action,recipient:target.params?.recipientId,cents:target.params?.cents,date:budgetDay(now),...target.params}];}
export function moneyReview(s,target,now=Date.now()){
 const raw=targetSteps(target,now),steps=raw.map((x,i)=>({...x,index:i,date:x.date||budgetDay(now)})).filter(x=>!target.runs||target.runs[x.index]?.status==='waiting');
 if(!steps.some(x=>['transfer','buy','record','save_in'].includes(x.kind)))return null;
 const consumptions=steps.filter(x=>x.kind==='record'||x.kind==='transfer'&&x.purpose==='expense'),existing=spendingRows(s).filter(x=>!target.replaceReceipt||x.id!==target.replaceReceipt),pending=pendingExpenses(s,target.id).filter(x=>x.id!==target.replaceReceipt),months=[...new Set(consumptions.map(x=>x.date.slice(0,7)))],warnings=[],budgets=[];
 for(const month of months){
  const plan=s.personalPlan||{},used=existing.filter(x=>x.date.startsWith(month)).reduce((n,x)=>n+x.cents,0),reserved=pending.filter(x=>x.date.startsWith(month)).reduce((n,x)=>n+x.cents,0),added=consumptions.filter(x=>x.date.startsWith(month)).reduce((n,x)=>n+x.cents,0),limit=plan.month===month?plan.budget||0:0,enabled=plan.month===month&&(plan.allocationMode==='balanced'||limit>0),projected=used+reserved+added;
  budgets.push({month,spent:used,scheduled:reserved,added,budget:limit,enabled,projected});
  if(enabled&&projected>0&&projected>=limit*.8)warnings.push({key:month+':total',type:'budget',month,limit,projected,shortfall:Math.max(0,projected-limit),requiresChoice:projected>limit,text:projected>limit?'月消费预算将超出':'月消费预算已接近',category:null});
  for(const category of budgetCategories){const cap=plan.month===month?plan.categoryBudgets?.[category]||0:0,increment=consumptions.filter(x=>x.date.startsWith(month)&&x.category===category).reduce((n,x)=>n+x.cents,0);if(!(plan.month===month&&(plan.allocationMode==='balanced'||cap>0))||!increment)continue;const total=[...existing,...pending].filter(x=>x.date.startsWith(month)&&x.category===category).reduce((n,x)=>n+x.cents,0)+increment;if(total>=cap*.8)warnings.push({key:month+':'+category,type:'category',month,category,limit:cap,projected:total,shortfall:Math.max(0,total-cap),requiresChoice:total>cap,text:category+(total>cap?'分类预算将超出':'分类预算已接近')});}
 }
 let balance=s.balance;const balancePath=[];
 for(const x of [...steps].sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index)){
  if(!['transfer','buy','save_in'].includes(x.kind))continue;
  const subs=x.includeSubscriptions?(s.subscriptions||[]).filter(x=>x.status==='active').reduce((n,x)=>n+x.cents,0):0,floor=Math.max(s.personalPlan?.reserve||0,(x.reserve||0)+subs);
  balance-=x.cents;balancePath.push({index:x.index,date:x.date,cents:x.cents,after:balance,floor});
  if(balance<floor)warnings.push({key:'reserve:'+x.index,type:'reserve',date:x.date,limit:floor,projected:balance,shortfall:floor-balance,requiresChoice:true,text:'操作后将低于最低保留金额'});
 }
 const policyHash=hash(s.personalPlan||null),review={id:target.id||null,recordOnly:steps.every(x=>x.kind==='record'),budgets,balanceBefore:s.balance,balanceAfter:balance,balancePath,warnings,requiresChoice:warnings.some(x=>x.requiresChoice),insufficient:balancePath.some(x=>x.after<0),policyHash};
 review.token=hash({...review,steps,day:budgetDay(now),spending:existing,pending});return review;
}
export function requireMoneyChoice(s,target,ack,now=Date.now()){
 const r=moneyReview(s,target,now);if(!r||!['approval',undefined].includes(target.status))return r;
 if(r.requiresChoice&&ack!==r.token){const e=Error('预算或保留金额需要你决定，请重新核对提示并勾选仅本次继续。');e.status=409;throw e;}return r;
}
export function recordMoneyChoice(s,target,review,now=Date.now()){
 if(!review)return;const decision={time:new Date(now).toISOString(),choice:review.requiresChoice?'continue-once':'normal',policyHash:review.policyHash,warnings:structuredClone(review.warnings),budgets:review.budgets,balanceBefore:review.balanceBefore,balanceAfter:review.balanceAfter,token:review.token};
 target.moneyDecision=decision;(s.events||=[]).push({time:decision.time,type:'budget.choice',taskId:target.id,text:review.requiresChoice?'用户核对预算与保留金额后选择仅本次继续':'已核对本次预算影响',details:decision});
}
export function canExecuteMoney(s,target,now=Date.now()){
 const r=moneyReview(s,target,now);if(!r?.requiresChoice)return true;
 const d=target.moneyDecision;if(!d||d.choice!=='continue-once'||d.policyHash!==r.policyHash)return false;
 return r.warnings.filter(x=>x.requiresChoice).every(x=>d.warnings.some(old=>old.key===x.key&&old.requiresChoice&&x.shortfall<=old.shortfall));
}
export function classifyTransfer(s,input,commit=false,now=Date.now()){
 const order=(s.orders||[]).find(x=>x.id===input.id&&x.action==='transfer'&&x.status==='success');if(!order)throw Error('这笔转账不属于当前账户，或尚未执行');
 if(typeof input.purpose!=='string')throw Error('请明确选择这笔转账的统计用途');const before=orderUse(s,order),use=transferUse(input),target={id:'classify:'+order.id,replaceReceipt:order.id,steps:use.purpose==='expense'?[{kind:'record',date:budgetDay(Date.parse(order.time)),cents:order.params.cents,category:use.category}]:[]};
 const review=moneyReview(s,target,now),copy={...s,transferUses:{...s.transferUses,[order.id]:{...use,updatedAt:new Date(now).toISOString()}}};
 if(commit){requireMoneyChoice(s,target,input.budgetAck,now);if(JSON.stringify(before)!==JSON.stringify(use)){s.transferUses=copy.transferUses;recordMoneyChoice(s,target,review,now);(s.events||=[]).push({time:new Date(now).toISOString(),type:'transfer.classified',text:'用户调整转账统计用途，资金未变动',details:{receipt:order.id,before,after:use}});}}
 return {id:order.id,use,review,budget:budgetSummary(copy,undefined,now),balance:s.balance};
}
