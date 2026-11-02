import {moneyReview} from './budget.mjs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const day=(now=Date.now())=>new Date(now+28800000).toISOString().slice(0,10);
export const policy=s=>s.securityPolicy||{simplify:false,threshold:100000};
export const targetKey=(s,id)=>hash(s.contacts.find(c=>c.id===id)||null);
export function dailyTransfers(s,date,excludeId){
 let used=(s.securityDailyTotals?.[date]||0)+s.orders.filter(o=>o.action==='transfer'&&day(Date.parse(o.time))===date).reduce((n,o)=>n+o.params.cents,0);
 for(const p of s.banking?.plans||[])if(p.id!==excludeId&&p.status==='scheduled')p.steps.forEach((x,i)=>{if(x.kind==='transfer'&&x.date===date&&p.runs[i].status==='waiting')used+=x.cents;});
 return used;
}
export function policyView(s,now=Date.now()){
 const rules=policy(s),used=dailyTransfers(s,day(now));return {...rules,used,remaining:Math.max(0,rules.threshold-used),date:day(now)};
}
export function requirement(s,target,now=Date.now()){
 const rules=policy(s),steps=target.steps?.[0]?.kind?target.steps:[{kind:target.action,recipient:target.params?.recipientId,cents:target.params?.cents,date:day(now)}];
 const days={},reasons=[];
 for(const x of steps){if(['buy','lost','recover','unlock','limit','security','save_in','save_out'].includes(x.kind))reasons.push('此操作须强验证');if(x.kind==='transfer'){
  const date=x.date||day(now);days[date]=(days[date]||0)+x.cents;
  if(!(s.verifiedPayees||[]).includes(targetKey(s,x.recipient)))reasons.push('收款人尚未通过强验证');
 }}
 for(const date of Object.keys(days)){
  const used=dailyTransfers(s,date,target.id);
  if(used+days[date]>Math.min(100000,rules.threshold))reasons.push('当日累计转账（含已预约）超过小额额度');
 }
 if(s.tasks.some(t=>t.status==='pending'&&t.id!==target.id)||s.banking?.plans.some(p=>p.status==='paused'&&p.id!==target.id))reasons.push('账户存在待核对或暂停操作');
 if((target.status==='approval'||!target.status)&&moneyReview(s,target,now)?.requiresChoice)reasons.push('超预算或低于最低保留金额，须核对后强验证');
 const strong=reasons.length>0;return {level:strong?'red':'yellow',pin:strong||!rules.simplify,totp:strong,reasons:[...new Set(reasons)],threshold:rules.threshold,simplify:rules.simplify,used:dailyTransfers(s,day(now),target.id),remaining:Math.max(0,rules.threshold-dailyTransfers(s,day(now),target.id))};
}
export function trustPayees(s,target){s.verifiedPayees||=[];const ids=target.steps?.[0]?.kind?target.steps.filter(x=>x.kind==='transfer').map(x=>x.recipient):target.action==='transfer'?[target.params.recipientId]:[];for(const id of ids){const key=targetKey(s,id);if(!s.verifiedPayees.includes(key))s.verifiedPayees.push(key);}}
export function validatePolicy(b){if(Object.keys(b).some(k=>!['simplify','threshold'].includes(k))||typeof b.simplify!=='boolean'||!Number.isSafeInteger(b.threshold)||b.threshold<100||b.threshold>100000)throw Error('小额日累计额度须为1至1000元（本演示设置范围）');return {simplify:b.simplify,threshold:b.threshold};}
export const stateSignature=s=>hash(s);
