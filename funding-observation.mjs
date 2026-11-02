import {wealthCashflow} from './wealth-context.mjs';
import {createHash,randomUUID} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day=n=>new Date(n+28800000).toISOString().slice(0,10);
const validAmount=n=>Number.isSafeInteger(n)&&n>=0;
const labels={transfer:'付款',buy:'模拟申购',redeem:'模拟赎回',save_in:'存入储蓄',save_out:'取回储蓄',cancel:'停止代扣'};
const at=value=>typeof value==='number'?new Date(value).toISOString():value||null;
export function fundingProgress(s,c,now=Date.now()){
 const items=[];
 for(const id of c.planIds||[]){const p=s.banking?.plans.find(p=>p.id===id);if(!p)continue;
  p.steps.forEach((x,i)=>{const run=p.runs?.[i]||{},receipt=s.orders.find(o=>o.id===run.receipt||o.planStep===p.id+':'+i),done=run.status==='done'&&Boolean(receipt);
   let state,label;
   if(done){state='done';label=labels[x.kind]?labels[x.kind]+'已完成':'已完成';}
   else if(run.status==='done'){state='review';label='结果待核对';}
   else if(run.status==='cancelled'||p.status==='cancelled'){state='cancelled';label='未执行部分已取消';}
   else if(['paused','invalidated'].includes(p.status)||run.status==='paused'){state='review';label=p.status==='invalidated'?'需重新核对':'已暂停';}
   else if(p.status==='approval'){state=now>=p.expires?'review':'approval';label=now>=p.expires?'确认已过期':'待核对与验证';}
   else if(p.status==='scheduled'&&x.kind==='transfer'&&x.date>day(now)){state='scheduled';label='已预约，等待执行';}
   else if(p.status==='scheduled'){state='review';label='已到期，等待核对';}
   else{state='review';label='结果待核对';}
   const recipient=s.contacts.find(a=>a.id===(x.recipient||x.recipientId));
   items.push({id:p.id+':'+i,planId:p.id,kind:x.kind,slot:p.fundingSlots?.[i]??null,title:x.kind==='transfer'?'付给 '+(recipient?.name||'原收款人'):labels[x.kind]||x.kind,cents:x.cents??null,date:x.date||null,state,label,reason:run.reason||null,receipt:done?receipt.id:null,executedAt:done?receipt.time:null,createdAt:at(p.created),approvedAt:at(p.approvedAt),cancelledAt:at(run.cancelledAt||p.cancelledAt),planStatus:p.status});
  });
 }
 const counts=Object.fromEntries(['done','scheduled','approval','review','cancelled'].map(k=>[k,items.filter(x=>x.state===k).length]));
 let state,label;
 const editing=c.planIds?.length&&!c.preview?.planId;
 if(editing){state='editing';label='需求已调整，待重新核对';}
 else if(counts.review){state='review';label='有事项需要核对';}
 else if(counts.approval){state='approval';label=counts.done?'部分完成，仍有事项待验证':'待核对与验证';}
 else if(counts.scheduled){state=counts.done?'partial':'scheduled';label=counts.done?'部分完成，仍有预约':'已预约，等待执行';}
 else if(counts.done){state='completed';label=counts.cancelled?'已执行部分完成，其余已取消':'全部办理完成';}
 else if(counts.cancelled){state='cancelled';label='未执行事项已取消';}
 else if(c.recordedAt){state='recorded';label='预留安排已记录，未划转资金';}
 else{state=c.preview?'preview':'collecting';label=c.preview?'方案已生成，待你核对':'正在整理需求';}
 return {state,label,counts,items,nextDate:items.filter(x=>x.state==='scheduled').map(x=>x.date).sort()[0]||null,updatedAt:at(Math.max(c.updated||c.created||now,...items.map(x=>Date.parse(x.executedAt||x.cancelledAt||x.approvedAt||x.createdAt)||0)))};
}
export function fundingPreferences(s){const p=s.fundingPreferences;return {revision:p?.revision||0,saved:validAmount(p?.reserveCents)?{reserveCents:p.reserveCents,confirmedAt:p.confirmedAt,updatedAt:p.updatedAt}:null,accountReserve:validAmount(s.personalPlan?.reserve)?s.personalPlan.reserve:null};}
export function changeFundingPreference(s,input,now=Date.now()){
 if(!input||Object.keys(input).some(k=>!['action','id','revision','preferenceRevision','confirmed'].includes(k))||!['save','forget'].includes(input.action)||input.confirmed!==true)throw Error('请明确确认保存或删除偏好');
 const current=fundingPreferences(s);if(input.preferenceRevision!==current.revision)throw Error('已保存偏好发生变化，请刷新后核对');
 let reserveCents=null;
 if(input.action==='save'){const c=s.fundingChat;if(!c||c.id!==input.id||c.revision!==input.revision||!validAmount(c.candidate.reserve)||c.candidate.reserve>100000000)throw Error('请先明确当前生活费金额，再确认记住');reserveCents=c.candidate.reserve;}
 s.fundingPreferences={revision:current.revision+1,...(reserveCents!==null?{reserveCents,confirmedAt:at(now),updatedAt:at(now)}:{forgottenAt:at(now)})};
 // Audit the choice and time without retaining a deleted preference value.
 s.events.push({id:randomUUID(),time:at(now),type:'funding.preference.'+input.action,text:input.action==='save'?'用户确认保存日常生活费偏好':'用户删除日常生活费偏好',details:{revision:current.revision+1}});
 return fundingPreferences(s);
}
export function cashflowObservation(s,now=Date.now(),days=30){
 if(!Number.isInteger(days)||days<1||days>366)throw Error('观察区间无效');
 const flow=wealthCashflow(s,days,now),floor=validAmount(s.personalPlan?.reserve)?s.personalPlan.reserve:0;
 const items=flow.items.filter(x=>Number.isSafeInteger(x.cents)&&x.cents>0).map(x=>({...x,...(x.source==='已授权预约转账'?{planId:x.id.slice(0,x.id.lastIndexOf(':'))}:{} )}));
 const duplicateDays=new Set();for(const x of items)if(items.some(y=>x.id!==y.id&&x.date===y.date&&x.cents===y.cents))duplicateDays.add(x.date);
 const groups=new Map();for(const x of items)groups.set(x.date,[...(groups.get(x.date)||[]),x]);
 let balance=s.balance;const timeline=[],alerts=[];
 if(balance<floor)alerts.push({date:flow.today,kind:'below-floor',after:balance,floor,shortfall:floor-balance,cents:0,items:[],opening:true,uncertain:false});
 for(const [date,rows]of [...groups].sort(([a],[b])=>a.localeCompare(b))){const cents=rows.reduce((n,x)=>n+x.cents,0);balance-=cents;const entry={date,cents,after:balance,floor,shortfall:Math.max(0,floor-balance),items:rows,uncertain:duplicateDays.has(date)};timeline.push(entry);if(entry.shortfall>0)alerts.push({...entry,kind:balance<0?'insufficient':'below-floor'});}
 const key=hash({balance:s.balance,floor,items:items.map(x=>({id:x.id,date:x.date,cents:x.cents})),day:flow.today});
 return {key,checkedAt:at(now),from:flow.today,until:flow.until,days,balance:s.balance,floor,total:items.reduce((n,x)=>n+x.cents,0),projectedEnd:balance,alerts,timeline,scope:'仅观察当前模拟账户已记录的计划开销、已授权预约及下一次有效代扣；同一天按合计支出计算。未完成确认的草案不计入，不推算工资、投资收益或赎回到账。预计值不代表已经付款，也不会自动改变任何安排。保留底线采用账户已设置金额，聊天偏好不会自动修改它。'};
}
