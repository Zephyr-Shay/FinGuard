import {openDialog} from './dialog.js';
import {showResult,pinField,otpField} from './security.js';
import {moneyReviewHTML,budgetAck} from './budget.js';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥'+(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'原记录未提供';
const cents=v=>{if(!/^\d+(\.\d{1,2})?$/.test(v))throw Error('金额最多两位小数');const [a,b='']=v.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<1||n>100000000)throw Error('金额须为0.01至100万元');return n;};
export function savingsEntryHTML(s={total:0,goals:[]}){return `<section class="savings-entry" id="goals-editor"><div><h2>储蓄空间</h2><p>已存 ${money(s.total||0)} · ${s.goals?.length||0} 个目标</p></div><button type="button" class="secondary" data-open-savings>管理储蓄 →</button></section>`;}
export function bindSavingsEntry(host,api,onChange){host.querySelectorAll('[data-open-savings]').forEach(b=>b.onclick=()=>openSavings(api,onChange).catch(e=>showResult('暂时无法读取储蓄',[e.message])));}
function progress(g){return Math.min(100,g.saved/g.target*100);}
export async function openSavings(api,onChange){
 const d=openDialog({id:'savings-space',title:'储蓄空间',wide:true,content:'正在读取储蓄账户…'});let view;
 async function reload(){if(!d.isConnected)return;const s=await api('/api/state');if(!d.isConnected)return;view=s.personal.savings;paint();}
 const changed=async()=>{await onChange?.();await reload();};
 function paint(){
  d.querySelector('.dialog-body').innerHTML=`<div class="savings-summary"><div><span>储蓄已存</span><strong>${money(view.total)}</strong><small>与可用余额分开存放</small></div><div><span>可用余额</span><strong>${money(view.available)}</strong><small>存入后减少，取回后恢复</small></div></div><div class="savings-heading"><h3>我的储蓄目标</h3><button type="button" class="primary" data-new-goal>＋ 新建目标</button></div>
  <div class="savings-goals">${view.goals.map(g=>`<article class="savings-goal"><header><div><h3>${h(g.title)}</h3><span>${g.saved>=g.target?'已达成':'目标 '+money(g.target)}</span></div><button type="button" class="mini-link" data-edit-goal="${h(g.id)}">管理</button></header><p class="savings-goal-amount">${money(g.saved)}<small> / ${money(g.target)}</small></p><progress max="${g.target}" value="${Math.min(g.saved,g.target)}" aria-label="${h(g.title)}已存${money(g.saved)}"></progress>${g.legacyRecorded?`<p class="savings-legacy">原手工进度 ${money(g.legacyRecorded)} 保留为历史记录，未计入实际储蓄余额。</p>`:''}<footer><small>${g.saved>=g.target?'目标已完成，可继续存入':`还差 ${money(g.target-g.saved)}`}</small><div><button type="button" class="secondary" data-save-out="${h(g.id)}" ${g.saved?'':'disabled'}>取回</button><button type="button" class="primary" data-save-in="${h(g.id)}">存入</button></div></footer></article>`).join('')||'<div class="savings-empty"><h3>创建第一个储蓄目标</h3><p>为旅行、应急或新的计划，单独存下一笔钱。</p></div>'}</div>
  <details class="savings-history"><summary>存取记录 · ${view.records.length} 笔</summary>${view.records.map(o=>`<button type="button" class="savings-record" data-saving-receipt="${h(o.id)}"><span><strong>${h(o.params.goalTitle)}</strong><small>${h(stamp(o.time))}</small></span><span>${o.action==='save_in'?'存入':'取回'} ${money(o.params.cents)}<small>查看回执 ›</small></span></button>`).join('')||'<p>尚无存取记录。</p>'}</details><p class="savings-note">模拟资金，不计利息。储蓄存取属于本人资金划转，不计入消费或收入。</p>`;
  d.querySelector('[data-new-goal]').onclick=()=>edit();
  d.querySelectorAll('[data-edit-goal]').forEach(b=>b.onclick=()=>edit(view.goals.find(g=>g.id===b.dataset.editGoal)));
  for(const [selector,kind,key]of [['[data-save-in]','save_in','saveIn'],['[data-save-out]','save_out','saveOut']])d.querySelectorAll(selector).forEach(b=>b.onclick=()=>move(view.goals.find(g=>g.id===b.dataset[key]),kind));
  d.querySelectorAll('[data-saving-receipt]').forEach(b=>b.onclick=()=>receipt(view.records.find(o=>o.id===b.dataset.savingReceipt)));
 }
 function receipt(o){showResult(o.action==='save_in'?'已存入储蓄':'已取回可用余额',[o.params.goalTitle+' · '+money(o.params.cents),'完成时间：'+stamp(o.time),'目标内余额：'+money(o.savings.after),'可用余额：'+money(o.savings.availableAfter),'回执：'+o.id]);}
 function edit(g){
  const e=openDialog({id:'savings-goal-editor',title:g?'管理储蓄目标':'新建储蓄目标',content:`<form class="savings-edit-form"><label>目标名称<input name="title" maxlength="40" value="${h(g?.title||'')}" placeholder="例如 应急储蓄" required></label><label>目标金额（元）<input name="target" inputmode="decimal" value="${g?g.target/100:''}" required></label>${g?`<p>实际已存 ${money(g.saved)}，由存入和取回自动更新。</p>`:''}<button class="primary">${g?'保存目标':'创建目标'}</button><p role="alert"></p></form>${g?'<button type="button" class="mini-link savings-delete" data-delete-goal>删除目标</button>':''}`});let busy=false;
  e.querySelector('form').onsubmit=async ev=>{ev.preventDefault();if(busy)return;busy=true;e.dataset.working='true';const b=e.querySelector('button.primary');b.disabled=true;try{const f=new FormData(ev.target);await api('/api/personal/goal',{...(g?{id:g.id}:{}),title:f.get('title'),target:cents(f.get('target'))});e.close();await changed();}catch(err){e.querySelector('[role=alert]').textContent=err.message;}finally{busy=false;e.dataset.working='false';b.disabled=false;}};
  e.querySelector('[data-delete-goal]')?.addEventListener('click',()=>{
   const c=openDialog({title:'删除这项目标？',content:`<p>${h(g.title)}</p><p>${g.saved?'请先取回目标内的 '+money(g.saved)+'，再删除。':'删除后保留历史存取回执。'}</p>${g.saved?'':'<button type="button" class="danger" data-confirm-delete>确认删除目标</button>'}<p role="alert"></p>`});
   c.querySelector('[data-confirm-delete]')?.addEventListener('click',async()=>{if(busy)return;busy=true;c.dataset.working='true';try{await api('/api/personal/goal',{id:g.id,remove:true});c.close();e.close();await changed();}catch(err){c.querySelector('[role=alert]').textContent=err.message;}finally{busy=false;c.dataset.working='false';}});
  });
 }
 function move(g,kind){
  const incoming=kind==='save_in',max=incoming?view.available:g.saved;
  const m=openDialog({id:'savings-amount',title:incoming?'存入储蓄':'取回储蓄',content:`<form class="savings-edit-form"><p class="savings-target">${h(g.title)}</p><label>${incoming?'存入':'取回'}金额（元）<input name="amount" inputmode="decimal" placeholder="0.00" required autofocus></label><p>${incoming?'可用余额':'目标内可取回金额'} ${money(max)} <button type="button" class="mini-link" data-saving-all>全部${incoming?'存入':'取回'}</button></p><button type="submit" class="primary">下一步，核对信息</button><p role="alert"></p></form>`});let busy=false;
  m.querySelector('[data-saving-all]').onclick=()=>m.querySelector('[name=amount]').value=(Math.min(max,100000000)/100).toFixed(2);
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy)return;const b=m.querySelector('button.primary');try{const n=cents(m.querySelector('[name=amount]').value);if(n>max)throw Error(incoming?'可用余额不足':'目标内储蓄余额不足');busy=true;m.dataset.working='true';b.disabled=true;const p=await api('/api/banking/plan',{title:(incoming?'存入储蓄 · ':'取回储蓄 · ')+g.title,steps:[{kind,goal:g.id,cents:n}]});m.close();await reviewSavings(p.id,api,changed);}catch(err){m.querySelector('[role=alert]').textContent=err.message;}finally{busy=false;m.dataset.working='false';b.disabled=false;}};
 }
 await reload();return d;
}
export async function reviewSavings(id,api,onChange){
 let bank=await api('/api/banking'),p=bank.plans.find(x=>x.id===id);if(!p)throw Error('这笔储蓄操作不存在');
 let pin='',ack={},working=false,stage='review';const x=p.steps[0],incoming=x.kind==='save_in';
 function result(r){const good=r.status==='completed',o=r.receipts?.[0]||bank.savings.records.find(o=>o.taskId===id);showResult(good?(incoming?'已存入储蓄':'已取回可用余额'):r.status==='cancelled'?'储蓄操作已取消':'储蓄操作未完成',[x.goalTitle+' · '+money(x.cents),...(good&&o?.savings?['目标内余额：'+money(o.savings.after),'可用余额：'+money(o.savings.availableAfter),'完成时间：'+stamp(o.time),'回执：'+o.id]:[r.runs[0].reason||'资金未划转','处理时间：'+stamp(r.updatedAt||r.processedAt)]),...(r.moneyDecision?.choice==='continue-once'?['已记录你选择仅本次继续，原最低保留金额保持不变。']:[])]);}
 if(p.status!=='approval'){result(p);return;}
 const d=openDialog({id:'savings-approval',title:incoming?'确认存入储蓄':'确认取回储蓄',content:''});
 function lock(v){working=v;d.dataset.working=String(v);d.querySelectorAll('input,button').forEach(el=>el.disabled=v);}
 function paint(){
  const index=stage==='review'?0:stage==='pin'?1:2;
  d.querySelector('.dialog-body').innerHTML=`<ol class="savings-steps">${['核对信息','支付密码','动态验证'].map((n,i)=>`<li ${i===index?'aria-current="step"':''}><span>${i+1}</span>${n}</li>`).join('')}</ol><form data-saving-confirm>
  ${stage==='review'?`<p class="savings-confirm-amount">${money(x.cents)}</p><p class="savings-target">${h(x.goalTitle)}</p><dl class="transfer-facts"><div><dt>资金方向</dt><dd>${incoming?'可用余额 → 储蓄目标':'储蓄目标 → 可用余额'}</dd></div><div><dt>操作后可用余额</dt><dd>${money(bank.balance+(incoming?-x.cents:x.cents))}</dd></div><div><dt>操作后目标余额</dt><dd>${money((bank.savings.goals.find(g=>g.id===x.goal)?.saved||0)+(incoming?x.cents:-x.cents))}</dd></div></dl>${moneyReviewHTML(p.moneyReview)}<button class="primary" data-saving-next>确认信息，下一步</button>`:stage==='pin'?`${pinField({pin:true,totp:false,reasons:[]})}<button class="primary" data-saving-pin>验证支付密码</button>`:`<p>${incoming?'存入':'取回'} ${money(x.cents)} · ${h(x.goalTitle)}</p>${otpField()}<button class="primary" data-saving-submit>确认${incoming?'存入':'取回'}</button>`}
  <button type="button" class="secondary" data-saving-cancel>取消本次操作</button><p role="alert"></p></form><p class="savings-note">申请时间：${h(stamp(p.created))} · 核对有效至 ${h(stamp(p.expires))}</p>`;
  d.querySelector('form').onsubmit=submit;d.querySelector('[data-saving-cancel]').onclick=cancel;
  if(stage!=='review')d.querySelector('input')?.focus({preventScroll:true});
 }
 async function submit(e){e.preventDefault();if(working)return;let sent=false;
  try{
   if(stage==='review'){ack=budgetAck(d);if(p.moneyReview?.requiresChoice&&!ack.budgetAck)throw Error('请核对保留金额差额，选择是否仅本次继续');stage='pin';paint();return;}
   if(stage==='pin'){pin=d.querySelector('#payment-pin').value;if(!/^\d{6}$/.test(pin))throw Error('请输入6位支付密码');lock(true);await api('/api/banking/plans/'+p.id+'/verify-pin',{token:p.token,paymentPin:pin});lock(false);stage='otp';paint();return;}
   const otp=d.querySelector('#verification-otp').value;if(!/^\d{6}$/.test(otp))throw Error('请输入6位动态验证码');lock(true);sent=true;const r=await api('/api/banking/plans/'+p.id+'/approve',{token:p.token,paymentPin:pin,totp:otp,...ack});pin='';d.close();result(r);await onChange?.();
  }catch(err){
   if(!d.isConnected)return;
   if(err.status===409){pin='';try{bank=await api('/api/banking');const fresh=bank.plans.find(a=>a.id===id);if(!fresh)throw Error('原操作不存在，请重新读取储蓄空间');p=fresh;if(p.status!=='approval'){d.close();result(p);await onChange?.();return;}stage='review';ack={};paint();}catch(readError){d.querySelector('[role=alert]').textContent=readError.message+'；请重新打开原操作核对。';d.querySelectorAll('button.primary').forEach(b=>b.hidden=true);return;}}
   d.querySelector('[role=alert]').textContent=err.message;
   if(sent&&!err.status&&stage==='otp'){pin='';d.querySelector('form').hidden=true;const b=document.createElement('button');b.className='primary';b.textContent='核对这笔存取的结果';b.onclick=async()=>{try{b.disabled=true;d.close();await reviewSavings(id,api,onChange);await onChange?.();}catch(readError){showResult('结果仍待核对',[readError.message,'请从储蓄存取记录或待办打开同一笔操作核对。']);}};d.querySelector('.dialog-body').append(b);}
  }finally{if(d.isConnected)lock(false);}
 }
 async function cancel(){if(working)return;lock(true);try{const r=await api('/api/banking/plans/'+p.id+'/cancel',{});pin='';d.close();result(r);await onChange?.();}catch(e){d.querySelector('[role=alert]').textContent=e.message;}finally{if(d.isConnected)lock(false);}}
 d.addEventListener('close',()=>{pin='';});paint();return d;
}
