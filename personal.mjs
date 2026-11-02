import {savingsGoals,savingsView,editSavingsGoal} from './savings.mjs';
import {budgetSummary,orderUse} from './budget.mjs';
import {randomUUID} from 'node:crypto';
export const categories=['居住','餐饮','生活','学习','订阅','交通','其他'];
const fail=m=>{throw new Error(m)};
const text=(v,n=60)=>typeof v==='string'&&v.trim()&&v.trim().length<=n?v.trim():fail('请输入有效名称或说明');
const amount=(v,zero=false)=>Number.isSafeInteger(v)&&v>=(zero?0:1)&&v<=100000000?v:fail('金额应为有效数字，最高100万元');
const date=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:fail('日期无效');
export function personal(engine){const s=engine.state;return {profile:s.profile||{nickname:"",avatar:"initial"},plan:s.personalPlan||{month:'2026-10',budget:0,reserve:0,categoryBudgets:{}},goals:savingsGoals(s),savings:savingsView(s),expenses:s.expenses||[],ledger:ledger(engine),budget:budgetSummary(s)};}
export function ledger(engine){const s=engine.state;
 const billRows=s.bills.map(b=>({...b,title:b.merchant,kind:'expense',source:'bill',account:'local'}));
 const kinds={transfer:'out',deposit:'in',buy:'investment',redemption_settlement:'settlement',save_in:'internal',save_out:'internal'};
 const orders=s.orders.filter(o=>kinds[o.action]&&Number.isSafeInteger(o.params?.cents)&&o.status==='success').map(o=>({id:o.id,date:new Date(Date.parse(o.time)+8*3600000).toISOString().slice(0,10),time:o.time,title:o.action==='transfer'?'转给 '+(s.contacts.find(c=>c.id===(o.params.recipientId||o.params.recipient))?.name||'原收款人'):o.action==='deposit'?(o.params.source||'模拟资金转入'):o.action==='buy'?'模拟理财申购':o.action==='save_in'?'存入储蓄 · '+o.params.goalTitle:o.action==='save_out'?'取回储蓄 · '+o.params.goalTitle:'模拟赎回到账',cents:o.params.cents,kind:o.action==='transfer'?(orderUse(s,o).purpose==='expense'?'expense':orderUse(s,o).purpose==='internal'?'internal':'out'):kinds[o.action],purpose:o.action==='transfer'?orderUse(s,o).purpose:null,category:o.action==='transfer'?orderUse(s,o).category:{transfer:'转账',deposit:'转入',buy:'理财',redemption_settlement:'理财',save_in:'储蓄',save_out:'储蓄'}[o.action],direction:o.action==='save_in'?'out':o.action==='save_out'?'in':null,savings:o.savings||null,source:'order',account:'local'}));
 const manual=(s.expenses||[]).filter(e=>e.status==='actual'&&!e.linkedId).map(e=>({...e,kind:'expense',source:'manual',account:'local'}));
 const imported=(s.importedBills||[]).map(r=>({...r,id:'import:'+r.key,title:r.merchant,kind:{收入:'income',支出:'expense',退款:'refund',账户互转:'internal'}[r.direction],source:'import',account:'import:'+r.account,accountName:r.account}));
 return [...billRows,...orders,...manual,...imported];
}
export function changePersonal(engine,path,b){
 const before=structuredClone(personal(engine)),result=applyPersonal(engine,path,b),time=new Date().toISOString();
 const collection={expense:'expenses',goal:'goals'},old=collection[path]?before[collection[path]].find(x=>x.id===b.id):path==='budget'?before.plan:null;
 engine.state.events.push({id:randomUUID(),time,type:'personal.'+path,text:({expense:'账单事项',goal:'储蓄目标',budget:'预算',contact:'收款人',profile:'个人资料'})[path]+(b.remove?'已删除':b.id?'已修改':'已保存'),details:{before:old,after:result}});
 return result;
}
function applyPersonal(engine,path,b){const s=engine.state;
 if(path==='profile'){if(!['initial','star','leaf'].includes(b.avatar))fail('头像选项无效');s.profile={nickname:text(b.nickname,24),avatar:b.avatar};return s.profile;}
 if(path==='contact'){
  if(b.id&&!s.contacts.some(c=>c.id===b.id))fail('收款人不存在');
  const c={id:b.id||randomUUID(),name:text(b.name,30),alias:typeof b.alias==='string'?b.alias.trim().slice(0,20):'',description:typeof b.description==='string'?b.description.trim().slice(0,50):'',tail:/^\d{4}$/.test(b.tail)?b.tail:fail('模拟账户尾号须为4位数字')};
  if(c.alias&&s.contacts.some(x=>x.id!==c.id&&x.alias===c.alias))fail('这个称呼已被其他联系人使用，请换一个');
  if(b.id)s.contacts=s.contacts.map(x=>x.id===c.id?c:x);else{if(s.contacts.length>=100)fail('最多100位联系人');s.contacts.push(c);}return c;
 }
 if(path==='budget'){
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month))fail('请选择月份');
  const cb=b.categoryBudgets;if(!cb||typeof cb!=='object'||Array.isArray(cb)||Object.keys(cb).some(k=>!categories.includes(k)))fail('预算类别无效');
  const reserve=amount(b.reserve,true),categoryBudgets=Object.fromEntries(categories.map(k=>[k,amount(cb[k]??0,true)]));
  const balanced=b.totalBudget!==undefined||s.personalPlan?.allocationMode==='balanced';
  if(balanced){
   const totalBudget=b.totalBudget!==undefined?b.totalBudget:amount(b.budget,true)+reserve;
   if(!Number.isSafeInteger(totalBudget)||totalBudget<0||totalBudget>200000000)fail('总预算须为有效金额，最高200万元');
   if(totalBudget<reserve)fail('保留金额不能超过本月总预算');
   const budget=amount(totalBudget-reserve,true);
   if(b.budget!==undefined&&b.budget!==budget)fail('消费预算必须等于总预算减去保留金额');
   if(Object.values(categoryBudgets).reduce((n,v)=>n+v,0)!==budget)fail('分类预算合计必须等于总预算减去保留金额，请先配平');
   s.personalPlan={month:b.month,totalBudget,budget,reserve,categoryBudgets,allocationMode:'balanced'};
  }else s.personalPlan={month:b.month,budget:amount(b.budget,true),reserve,categoryBudgets};
  return s.personalPlan;
 }
 if(path==='goal')return editSavingsGoal(s,b);
 if(path==='expense'){
  s.expenses||=[];if(b.id&&!s.expenses.some(x=>x.id===b.id))fail('记录不存在');
  if(b.remove){s.expenses=s.expenses.filter(x=>x.id!==b.id);return {ok:true};}
  const prior=s.expenses.find(x=>x.id===b.id);const row={id:b.id||randomUUID(),createdAt:prior?.createdAt||(b.id?null:new Date().toISOString()),updatedAt:new Date().toISOString(),title:text(b.title),date:date(b.date),cents:amount(b.cents),category:categories.includes(b.category)?b.category:fail('类别无效'),status:['planned','actual','cancelled'].includes(b.status)?b.status:fail('状态无效'),linkedId:b.linkedId||null};
  if(row.linkedId){const bill=s.bills.find(x=>x.id===row.linkedId)||ledger(engine).find(x=>x.id===row.linkedId&&x.kind==='expense'&&x.source==='order');if(!bill||row.status!=='actual')fail('只能关联已有消费账单');if(s.expenses.some(x=>x.id!==row.id&&x.linkedId===row.linkedId))fail('这笔账单已关联其他事项');row.cents=bill.cents;row.date=bill.date;row.category=bill.category;}
  if(b.id)s.expenses=s.expenses.map(x=>x.id===b.id?row:x);else{if(s.expenses.length>=500)fail('最多500条事项');s.expenses.push(row);}return row;
 }
 fail('没有这个操作');
}
