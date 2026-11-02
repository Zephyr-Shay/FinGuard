import {randomUUID} from 'node:crypto';
const fail=m=>{throw Error(m);};
const amount=n=>Number.isSafeInteger(n)&&n>0&&n<=100000000?n:fail('金额须为0.01至100万元，最多两位小数');
export function savingsBalance(s,id){const n=s.savings?.balances?.[id]??0;if(!Number.isSafeInteger(n)||n<0)fail('储蓄余额异常，请核对记录');return n;}
export function savingsGoals(s){return (s.goals||[]).map(g=>({...g,saved:savingsBalance(s,g.id),legacyRecorded:g.funding==='account'?(g.legacyRecorded||0):(g.saved||0)}));}
export function savingsView(s){const goals=savingsGoals(s),total=Object.values(s.savings?.balances||{}).reduce((n,v)=>{if(!Number.isSafeInteger(v)||v<0)fail('储蓄余额异常');return n+v;},0);return {total,available:s.balance,goals,records:(s.orders||[]).filter(o=>['save_in','save_out'].includes(o.action)&&o.status==='success').slice().reverse()};}
export function savingsTarget(s,id){const g=(s.goals||[]).find(g=>g.id===id)||fail('储蓄目标不存在，请重新选择');return {id:g.id,title:g.title,target:g.target,revision:g.revision||0,balance:savingsBalance(s,id)};}
export function editSavingsGoal(s,b,now=Date.now()){
 if(Object.keys(b).some(k=>!['id','title','target','saved','remove'].includes(k)))fail('储蓄目标只可修改名称和目标金额');
 s.goals||=[];const old=b.id?s.goals.find(g=>g.id===b.id):null;if(b.id&&!old)fail('目标不存在');
 if(b.remove){
  if(!old)fail('请选择要删除的目标');if(savingsBalance(s,b.id)>0)fail('请先取回这项目标内的资金，再删除目标');
  if((s.banking?.plans||[]).some(p=>['approval','scheduled','paused'].includes(p.status)&&p.steps.some(x=>x.goal===b.id)))fail('请先取消这项目标尚未完成的存取操作');
  s.goals=s.goals.filter(g=>g.id!==b.id);return {ok:true,id:b.id,removedAt:new Date(now).toISOString()};
 }
 if(b.saved!==undefined&&b.saved!==0)fail('储蓄余额由实际存入和取回更新，不能手工填写进度');
 if(typeof b.title!=='string'||!b.title.trim()||b.title.trim().length>40)fail('目标名称须为1至40字');
 const target=amount(b.target);if(!old&&s.goals.length>=30)fail('最多30个储蓄目标');
 const row={id:old?.id||randomUUID(),title:b.title.trim(),target,saved:old?savingsBalance(s,old.id):0,funding:'account',legacyRecorded:old?(old.funding==='account'?old.legacyRecorded||0:old.saved||0):0,revision:(old?.revision||0)+1,createdAt:old?.createdAt||new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
 if(old)s.goals=s.goals.map(g=>g.id===row.id?row:g);else s.goals.push(row);return row;
}
export function normalizeSavings(s,x){const goal=savingsTarget(s,x.goal),cents=amount(x.cents);return {kind:x.kind,goal:goal.id,goalTitle:goal.title,cents,card:'main'};}
export function moveSavings(s,x,now=Date.now()){
 const g=(s.goals||[]).find(g=>g.id===x.goal)||fail('储蓄目标不存在'),before=savingsBalance(s,g.id),cents=amount(x.cents),totalBefore=savingsView(s).total;
 if(x.kind==='save_in'&&s.balance<cents)fail('可用余额不足，无法存入储蓄');
 if(x.kind==='save_out'&&before<cents)fail('这项目标的储蓄余额不足，无法取回');
 if(!['save_in','save_out'].includes(x.kind))fail('储蓄操作无效');
 const balanceAfter=s.balance+(x.kind==='save_in'?-cents:cents),savedAfter=before+(x.kind==='save_in'?cents:-cents);
 if(!Number.isSafeInteger(balanceAfter)||!Number.isSafeInteger(savedAfter)||savedAfter<0||balanceAfter<0)fail('储蓄金额超出有效范围');
 const totalAfter=totalBefore+(x.kind==='save_in'?cents:-cents);if(!Number.isSafeInteger(totalAfter)||totalAfter<0)fail('储蓄总额异常');
 s.savings||={balances:{}};s.savings.balances||={};s.savings.balances[g.id]=savedAfter;s.balance=balanceAfter;
 if(g.funding!=='account'){g.legacyRecorded=g.saved||0;g.funding='account';}g.saved=savedAfter;g.lastFundedAt=new Date(now).toISOString();
 return {goal:g.id,title:g.title,before,after:savedAfter,availableAfter:balanceAfter,totalAfter};
}
