import {normalizeSavings,savingsTarget,moveSavings,savingsView} from './savings.mjs';
import {transferUse,canExecuteMoney,spendingRows} from './budget.mjs';
import {DEFAULT_CARD_LIMIT,MAX_TRANSFER_AMOUNT,LEGACY_CARD_LIMIT} from './limits.mjs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {requirement} from './verification.mjs';
import {LIMIT} from './core.mjs';
import {wealthStateSignature} from './wealth-context.mjs';
const fail=m=>{throw Error(m)}, hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const transactionAmount=n=>Number.isSafeInteger(n)&&n>=1&&n<=MAX_TRANSFER_AMOUNT?n:fail('金额须为0.01至1000万元，最多两位小数');
const amount=(n,zero=false)=>Number.isSafeInteger(n)&&n>=(zero?0:1)&&n<=100000000?n:fail('金额无效');
const date=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s?s:fail('日期无效');
export const today=(now=Date.now())=>new Date(now+8*3600000).toISOString().slice(0,10);
export const products=Object.freeze([
 {id:'cash',name:'模拟现金管理 A',risk:1,min:10000,days:1,description:'仅合成演示；非保本，不保证本金或收益'},
 {id:'bond',name:'模拟稳健组合 B',risk:2,min:10000,days:3,description:'仅合成演示；净值可能下跌，赎回模拟 T+3 自然日到账'},
 {id:'growth',name:'模拟成长组合 C',risk:3,min:10000,days:5,description:'仅合成演示；较高波动，不保证本金或收益'},
 {id:'fund_202301',name:'南方现金增利货币A · 模拟',risk:1,min:10000,days:1,suitableDays:7,code:'202301',description:'真实基金资料参考；演示按本金记账，不模拟实际净值、费率或收益'},
 {id:'fund_004672',name:'华夏短债债券A · 模拟',risk:2,min:10000,days:3,suitableDays:90,code:'004672',description:'真实基金资料参考；演示按本金记账，不模拟实际净值、费率或收益'},
 {id:'fund_000216',name:'华安黄金ETF联接A · 模拟',risk:3,min:10000,days:5,suitableDays:365,code:'000216',description:'真实基金资料参考；演示按本金记账，不模拟实际净值、费率或收益'}
]);
export function initBank(s){s.banking||={plans:[],cards:[{id:'main',name:'模拟借记卡',tail:'5100',status:'active',limit:DEFAULT_CARD_LIMIT,limitCustomized:false}],cardLimitsVersion:2,risk:null,holdings:{},settlements:[],aa:[]};return s.banking}
export function upgradeCardLimits(s,now=Date.now()){
 const b=s.banking;if(!b||b.cardLimitsVersion===2)return false;
 for(const c of b.cards||[]){
  const wasCustomized=c.limitCustomized===true||(b.plans||[]).some(p=>p.steps.some((x,i)=>x.kind==='limit'&&x.card===c.id&&p.runs?.[i]?.status==='done'));
  if(c.limit===LEGACY_CARD_LIMIT&&!wasCustomized){const before=c.limit;c.limit=DEFAULT_CARD_LIMIT;c.limitCustomized=false;(s.events||=[]).push({id:randomUUID(),time:new Date(now).toISOString(),type:'card.limit.default_updated',text:'默认单笔交易限额更新为500万元',details:{card:c.id,before,after:c.limit}});}
  else c.limitCustomized=wasCustomized||c.limit!==LEGACY_CARD_LIMIT;
 }
 b.cardLimitsVersion=2;return true;
}
function contact(s,id){return s.contacts.find(c=>c.id===id)||fail('请选择当前账号的收款人')}
function product(id){return products.find(p=>p.id===id)||fail('产品不存在')}
function binding(s,p){return hash({id:p.id,steps:p.steps,expires:p.expires,...(p.steps.some(x=>['save_in','save_out'].includes(x.kind))?{savingsTargets:p.steps.filter(x=>['save_in','save_out'].includes(x.kind)).map(x=>savingsTarget(s,x.goal))}:{}),targets:p.steps.filter(x=>x.kind==='transfer').map(x=>contact(s,x.recipient))})}
function event(s,p,type,detail,now){p.updatedAt=now;p.timeline||=[];p.timeline.push({time:new Date(now).toISOString(),type,text:detail});s.events.push({id:randomUUID(),taskId:p.id,time:new Date(now).toISOString(),type,text:detail,details:{module:'banking'}})}
export function normalizeStep(s,x,now){
 if(!x||typeof x!=='object'||Array.isArray(x))fail('计划步骤无效');
 if(['save_in','save_out'].includes(x.kind))return normalizeSavings(s,x);
 if(x.kind==='transfer'){
  contact(s,x.recipient);const cents=transactionAmount(x.cents);if(cents>(initBank(s).cards.find(c=>c.id==='main')?.limit||DEFAULT_CARD_LIMIT))fail('超过当前付款卡单笔限额，请先到卡片与安全调整');
  const when=date(x.date);if(when<today(now)||when>today(now+366*86400000))fail('执行日期须在今天至未来一年以内');
  return {kind:x.kind,recipient:x.recipient,cents,...transferUse(x),date:when,reserve:amount(x.reserve,true),includeSubscriptions:x.includeSubscriptions===true,card:'main'};
 }
 if(x.kind==='cancel'){if(!s.subscriptions.some(a=>a.id===x.subscription&&a.status==='active'))fail('订阅不存在或已取消');return {kind:x.kind,subscription:x.subscription}}
 if(['lock','unlock','lost','recover','limit'].includes(x.kind)){
  const c=initBank(s).cards.find(c=>c.id===x.card);if(!c)fail('卡片不存在');if(x.kind==='recover'&&c.status!=='lost')fail('只有已挂失卡片可以解除挂失');return {kind:x.kind,card:x.card,...(x.kind==='recover'?{lossId:c.lossId||'legacy'}:{}),...(x.kind==='limit'?{cents:transactionAmount(x.cents)}:{})};
 }
 if(x.kind==='buy'){const p=product(x.product),cents=amount(x.cents);if(cents<p.min)fail('低于模拟起购金额');return {kind:x.kind,product:p.id,cents,reserve:amount(x.reserve??0,true)}}
 if(x.kind==='redeem'){product(x.product);return {kind:x.kind,product:x.product,cents:amount(x.cents)}}
 fail('不支持的计划动作');
}
export function draftPlan(s,input,now=Date.now()){
 const b=initBank(s);if(b.plans.length>=200)fail('计划已达200个，请使用独立演示账号');
 if(!Array.isArray(input.steps)||input.steps.length<1||input.steps.length>12)fail('计划须包含1至12个明确步骤');
 const steps=input.steps.map(x=>normalizeStep(s,x,now));
 if(steps.some(x=>['save_in','save_out'].includes(x.kind))&&steps.length!==1)fail('每次只确认一笔储蓄存入或取回');
 const purchaseTotal=steps.filter(x=>x.kind==='buy').reduce((n,x)=>n+x.cents,0);if(purchaseTotal>(b.cards.find(c=>c.id==='main')?.limit||0))fail('整份申购计划超过付款卡限额，不得拆单');
 const transferDays={};for(const x of steps)if(x.kind==='transfer'){const k=x.recipient+'|'+x.date;transferDays[k]=(transferDays[k]||0)+x.cents;if(transferDays[k]>MAX_TRANSFER_AMOUNT)fail('同日计划金额超过演示总额上限');}
 const p={id:randomUUID(),title:String(input.title||'银行业务计划').slice(0,100),steps,status:'approval',created:now,expires:now+300000,token:randomBytes(24).toString('hex'),runs:steps.map(()=>({status:'waiting'}))};
 p.binding=binding(s,p);b.plans.push(p);event(s,p,'plan.created','生成完整计划，尚未授权',now);return publicPlan(p);
}
export function changeTransferUse(s,id,index,input,now=Date.now()){
 const p=initBank(s).plans.find(p=>p.id===id)||fail('计划不存在');if(p.status!=='approval'||!Number.isInteger(index)||p.steps[index]?.kind!=='transfer')fail('只能调整待确认转账的统计用途');p.steps[index]=normalizeStep(s,{...p.steps[index],...transferUse(input)},now);p.token=randomBytes(24).toString('hex');p.expires=now+300000;p.binding=binding(s,p);delete p.moneyDecision;event(s,p,'plan.use.changed','用户调整转账统计用途，需重新核对授权',now);return publicPlan(p);
}
export function publicPlan(p){const {binding,authorization,...safe}=structuredClone(p);return safe}
function runStep(s,p,i,now){const x=p.steps[i],b=initBank(s),r=p.runs[i],key=p.id+':'+i;
 if(['done','cancelled'].includes(r.status))return;
 const old=s.orders.find(o=>o.planStep===key);if(old){r.status='done';r.receipt=old.id;r.executedAt=Date.parse(old.time);return;}
 if(x.kind==='transfer'&&x.date>today(now))return;
 try{
  let savingsReceipt=null;
  if(['transfer','buy','save_in'].includes(x.kind)&&!canExecuteMoney(s,p,now))fail('预算或最低保留金额的影响已变化，需要重新核对后选择是否继续');
  if(x.kind==='transfer'){
   if(p.verificationLevel&&p.verificationLevel!=='red'&&requirement(s,{id:p.id,steps:[x]},now).totp)fail('累计金额或账户风险已变化，须重新强验证');
   // Missed dated mandates never silently execute on a later date.
   if(x.date<today(now))fail('执行日已过，需取消并重新生成计划');
   const c=b.cards.find(c=>c.id===x.card);if(!c||c.status!=='active')fail('付款卡已锁定或挂失');
   if(x.cents>c.limit)fail('超过当前卡片交易限额');
   const spent=s.orders.filter(o=>o.action==='transfer'&&o.params.recipientId===x.recipient&&today(Date.parse(o.time))===today(now)).reduce((a,o)=>a+o.params.cents,0);
   if(spent+x.cents>LIMIT&&p.verificationLevel!=='red')fail('当日累计金额增加，需重新强验证');
   const sub=x.includeSubscriptions?s.subscriptions.filter(a=>a.status==='active').reduce((a,v)=>a+v.cents,0):0;
   if(s.balance<x.cents)fail('可用余额不足，不能执行这一步');
   if(s.balance-x.cents<x.reserve+sub&&!p.moneyDecision)fail('余额不足以保留约定生活费和一个周期代扣预算');
   s.balance-=x.cents;
  }else if(['save_in','save_out'].includes(x.kind)){const card=b.cards.find(c=>c.id===x.card);if(!card||card.status!=='active')fail('银行卡已锁定或挂失，请先处理卡片状态');if(x.cents>card.limit)fail('超过当前卡片交易限额');if(p.verificationLevel!=='red')fail('储蓄资金划转须完成支付密码与动态验证');savingsReceipt=moveSavings(s,x,now);}
  else if(x.kind==='cancel'){const sub=s.subscriptions.find(a=>a.id===x.subscription);if(!sub||sub.status!=='active')fail('订阅状态已变化');sub.status='cancelled';}
  else if(['lock','unlock','lost','recover','limit'].includes(x.kind)){const c=b.cards.find(c=>c.id===x.card);if(!c)fail('卡片不存在');if(x.kind==='recover'){if(c.status!=='lost'||(c.lossId||'legacy')!==x.lossId)fail('挂失状态已变化，请重新核对');c.status=c.beforeLost==='locked'?'locked':'active';delete c.beforeLost;delete c.lossId;}else{if(c.status==='lost')fail('卡片已挂失，请先通过解除挂失恢复');if(x.kind==='limit'){c.limit=transactionAmount(x.cents);c.limitCustomized=true;}else{if(x.kind==='lost'){c.beforeLost=c.status;c.lossId=randomUUID();}c.status={lock:'locked',unlock:'active',lost:'lost'}[x.kind];}}}
  else if(x.kind==='buy'){const prod=product(x.product);const card=b.cards.find(c=>c.id==='main');if(!card||card.status!=='active')fail('付款卡已锁定或挂失，不能申购');if(p.steps.filter(step=>step.kind==='buy').reduce((sum,step)=>sum+step.cents,0)>card.limit)fail('整份申购计划超过当前付款卡限额');if(x.cents>card.limit)fail('申购金额超过付款卡单笔限额');if(b.risk&&now-b.risk.at>365*86400000)fail('风险评估已过期，请重新评估');if(s.balance-x.cents<(x.reserve||0)&&!p.moneyDecision)fail('申购后余额不足以保留约定资金');if(!b.risk||b.risk.level<prod.risk)fail('风险评估未完成或风险承受能力不匹配');if(s.balance<x.cents)fail('可用余额不足');s.balance-=x.cents;b.holdings[x.product]=(b.holdings[x.product]||0)+x.cents;}
  else if(x.kind==='redeem'){if((b.holdings[x.product]||0)<x.cents)fail('可赎回持仓不足');b.holdings[x.product]-=x.cents;b.settlements.push({id:key,product:x.product,cents:x.cents,requestedAt:now,due:now+product(x.product).days*86400000,status:'pending'});}
  const o={id:'FG-'+randomUUID(),taskId:p.id,planStep:key,action:x.kind,params:{...x,...(x.kind==='transfer'?{recipientId:x.recipient}:{})},time:new Date(now).toISOString(),status:'success',after:s.balance,...(savingsReceipt?{savings:savingsReceipt}:{})};s.orders.push(o);r.status='done';r.receipt=o.id;r.executedAt=now;delete r.reason;event(s,p,'step.executed',`步骤${i+1}已执行并核对`,now);
 }catch(e){r.status='paused';r.pausedAt=now;r.reason=e.message;event(s,p,'step.paused',`步骤${i+1}暂停：${e.message}`,now);}
}
function executePlan(s,p,now){if(p.authorization!==binding(s,p)){p.status='invalidated';event(s,p,'plan.invalidated','收款人或计划参数变化，授权失效',now);return;}
 if(p.wealthGuard&&p.wealthGuard!==wealthStateSignature(s)){p.status='invalidated';event(s,p,'plan.invalidated','理财所依据的余额、风险或近期用款已变化，请重新与AI核对',now);return;}
 for(let i=0;i<p.steps.length;i++){if(p.runs[i].status==='paused')break;runStep(s,p,i,now);if(p.runs[i].status==='paused')break;}
 p.updatedAt=now;p.status=p.runs.every(r=>r.status==='done')?'completed':p.runs.some(r=>r.status==='paused')?'paused':'scheduled';
}
export function approvePlan(s,id,token,now=Date.now()){
 const p=initBank(s).plans.find(p=>p.id===id)||fail('计划不存在');if(p.status!=='approval')return publicPlan(p);
 if(p.fundingGuard&&p.fundingGuard!==wealthStateSignature(s))fail('资金安排所依据的账户或未来用款已变化，请回到统一安排重新生成');
 if(typeof token!=='string'||token!==p.token)fail('授权凭证无效');if(now>=p.expires)fail('确认已过期，请重新生成计划');
 if(binding(s,p)!==p.binding)fail('计划对象或参数已变化，请重新生成');p.approvedAt=now;p.authorization=p.binding;delete p.token;p.status='scheduled';event(s,p,'plan.approved','用户明确批准全部步骤及各执行日期',now);executePlan(s,p,now);return publicPlan(p);
}
export function cancelPlan(s,id,now=Date.now()){const p=initBank(s).plans.find(p=>p.id===id)||fail('计划不存在');if(p.status==='completed')fail('已完成的操作不能撤销');if(p.status==='cancelled')return publicPlan(p);p.status='cancelled';p.cancelledAt=now;delete p.token;for(const r of p.runs)if(r.status!=='done'){r.status='cancelled';r.cancelledAt=now;}event(s,p,'plan.cancelled','取消未执行步骤，已执行操作保留',now);return publicPlan(p)}
export function tickBank(s,now=Date.now()){
 const b=initBank(s);let changed=false;
 for(const p of b.plans)if(p.status==='scheduled'&&p.steps.some((x,i)=>p.runs[i].status==='waiting'&&(x.kind!=='transfer'||x.date<=today(now)))){executePlan(s,p,now);changed=true;}
 for(const a of b.settlements)if(a.status==='pending'&&a.due<=now){s.balance+=a.cents;a.status='settled';a.settledAt=now;event(s,{id:a.id},'redemption.settled','模拟赎回到账 '+(a.cents/100).toFixed(2)+'元',now);s.orders.push({id:'FG-'+randomUUID(),taskId:a.id,action:'redemption_settlement',params:{cents:a.cents,product:a.product},time:new Date(now).toISOString(),status:'success'});changed=true;}
 return changed;
}
export function assessRisk(s,answers){if(!Array.isArray(answers)||![3,5].includes(answers.length)||answers.some(n=>!Number.isInteger(n)||n<1||n>3))fail('请完成风险问卷');initBank(s).risk={answers,level:Math.min(...answers),at:Date.now(),simulation:true};return initBank(s).risk;}
export function splitAA(s,input){const cents=amount(input.cents);if(!Array.isArray(input.recipients)||input.recipients.length<2||input.recipients.length>20||new Set(input.recipients).size!==input.recipients.length)fail('请选择2至20个不同参与人');input.recipients.forEach(id=>contact(s,id));if(cents<input.recipients.length)fail('总额过小');const b=initBank(s);if(b.aa.length>=100)fail('AA任务达到上限');const row={id:randomUUID(),created:Date.now(),title:String(input.title||'AA分摊').slice(0,80),cents,shares:input.recipients.map((id,i)=>({id,cents:Math.floor(cents/input.recipients.length)+(i<cents%input.recipients.length?1:0),status:'unpaid'}))};b.aa.push(row);return row;}
export function markAA(s,id,recipient){const row=initBank(s).aa.find(a=>a.id===id)||fail('AA任务不存在'),r=row.shares.find(a=>a.id===recipient)||fail('参与人不存在');r.status='recorded';r.recordedAt=Date.now();return row;}
export function periodReport(s,period){if(!/^20\d{2}(-(0[1-9]|1[0-2]))?$/.test(period))fail('请选择月份或年份');const records=[...s.bills,...spendingRows(s).filter(x=>x.source!=='bill').map(x=>({...x,merchant:x.title}))].filter(r=>r.date.startsWith(period)),categories={};for(const r of records)categories[r.category]=(categories[r.category]||0)+r.cents;return {period,total:records.reduce((a,r)=>a+r.cents,0),categories,records,scope:'统计模拟账本已记录消费，含明确消费付款和实际补记；缺失日期不代表零支出，不含划转、本人互转、理财本金或独立导入账户'};}
export function recurring(s){const groups=new Map();for(const r of s.bills){const key=r.merchant+'|'+r.cents;const a=groups.get(key)||[];a.push(r);groups.set(key,a);}return [...groups.values()].filter(a=>new Set(a.map(r=>r.date.slice(0,7))).size>=3).map(a=>({merchant:a[0].merchant,cents:a[0].cents,months:[...new Set(a.map(r=>r.date.slice(0,7)))],evidence:a.map(r=>r.id),subscription:s.subscriptions.find(s=>s.name===a[0].merchant)?.id||null,notice:'连续至少三个月同商户同金额，仅为疑似周期扣费，请核实'}));}
export function bankView(s){const b=initBank(s);return {...b,plans:b.plans.map(publicPlan),savings:savingsView(s),products,recurring:recurring(s)}}

export function reviewRemaining(s,id,now=Date.now()){
 const p=initBank(s).plans.find(p=>p.id===id)||fail('计划不存在');if(!['paused','invalidated'].includes(p.status)||!p.steps.every(x=>x.kind==='transfer'))fail('请从原事项重新提出资金安排');
 const steps=p.steps.filter((x,i)=>!['done','cancelled'].includes(p.runs[i].status));if(!steps.length)fail('没有待重新核对的步骤');if(steps.some(x=>x.date<today(now)))fail('原执行日期已过，请重新选择执行日期，不能自动改到今天');
 const next=draftPlan(s,{title:p.title+' · 重新核对',steps},now);cancelPlan(s,p.id,now);p.replacementId=next.id;initBank(s).plans.find(x=>x.id===next.id).originalPlanId=p.id;event(s,p,'plan.replaced','用户重新核对剩余转账，新操作尚未授权',now);return next;
}
