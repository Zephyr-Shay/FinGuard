import {spendingRows} from './budget.mjs';
import {createHash} from 'node:crypto';
export const wealthDay=(now=Date.now())=>new Date(now+28800000).toISOString().slice(0,10);
export function wealthStateSignature(s){return createHash('sha256').update(JSON.stringify({balance:s.balance,risk:s.banking?.risk,cards:s.banking?.cards,holdings:s.banking?.holdings,plan:s.personalPlan,spending:spendingRows(s),expenses:(s.expenses||[]).filter(x=>x.status==='planned'),subscriptions:s.subscriptions,transfers:(s.banking?.plans||[]).filter(p=>p.status==='scheduled'&&p.steps.some(x=>x.kind==='transfer')).map(p=>({id:p.id,status:p.status,steps:p.steps,runs:p.runs}))})).digest('hex');}
export function wealthCashflow(s,horizon=30,now=Date.now()){
 const today=wealthDay(now),until=wealthDay(now+Math.min(horizon||30,3650)*86400000),items=[];
 for(const x of s.expenses||[])if(x.status==='planned'&&x.date>=today&&x.date<=until)items.push({id:x.id,title:x.title,date:x.date,cents:x.cents,source:'计划开销'});
 for(const x of s.subscriptions||[])if(x.status==='active'&&x.next>=today&&x.next<=until)items.push({id:x.id,title:x.name,date:x.next,cents:x.cents,source:'已知下次代扣'});
 for(const p of s.banking?.plans||[])if(p.status==='scheduled')p.steps.forEach((x,i)=>{if(x.kind==='transfer'&&p.runs[i]?.status==='waiting'&&x.date>=today&&x.date<=until)items.push({id:p.id+':'+i,title:p.title,date:x.date,cents:x.cents,source:'已授权预约转账'});});
 const known=items.reduce((n,x)=>n+x.cents,0),configured=Math.max(0,s.personalPlan?.reserve||0),month=today.slice(0,7),budget=s.personalPlan?.month===month?Math.max(0,s.personalPlan.budget||0):0,spent=spendingRows(s).filter(x=>x.date?.startsWith(month)).reduce((n,x)=>n+x.cents,0),budgetRemaining=Math.max(0,budget-spent);return {today,until,balance:s.balance,configured,known,budgetRemaining,budgetMonth:budget?month:null,minimum:Math.max(configured,known,budgetRemaining),items:items.sort((a,b)=>a.date.localeCompare(b.date)),scope:'当前模拟账户；计入已记录的计划开销、已知下一次有效代扣、已授权预约转账及当月未用预算。不推算工资；历史账单仅用于核算剩余预算，不再次扣余额。保留金额视为包含这些支出。'};
}
