import {openDialog} from './dialog.js';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥'+(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const categories=['居住','餐饮','生活','学习','订阅','交通','其他'];
export const purposeName=x=>x.purpose==='expense'?'消费付款 · '+x.category:x.purpose==='internal'?'本人账户互转 · 不计消费':'资金划转 · 不计消费';
export function useFields(value={},index=''){
 return `<div class="transfer-use" data-use-index="${h(index)}"><label>这笔转账用于什么？<select name="purpose" data-transfer-purpose>${[['transfer','资金划转／用途未分类'],['expense','消费付款 · 计入预算'],['internal','本人账户互转 · 不计消费']].map(([k,v])=>`<option value="${k}" ${(value.purpose||'transfer')===k?'selected':''}>${v}</option>`).join('')}</select></label><label data-purpose-category ${value.purpose==='expense'?'':'hidden'}>消费分类<select name="category" data-transfer-category>${categories.map(x=>`<option ${x===value.category?'selected':''}>${x}</option>`).join('')}</select></label><p class="muted">消费付款会计入账单、日历和消费预算；资金划转与本人互转只记资金流动。选择用途不改变收款人。</p></div>`;
}
export function bindUseFields(host,onChange=null){host.querySelectorAll('.transfer-use').forEach(row=>{const select=row.querySelector('[data-transfer-purpose]');select.onchange=()=>{row.querySelector('[data-purpose-category]').hidden=select.value!=='expense';onChange?.(row);};row.querySelector('[data-transfer-category]').onchange=()=>onChange?.(row);});}
export const readUse=row=>({purpose:row.querySelector('[data-transfer-purpose]').value,category:row.querySelector('[data-transfer-category]').value});
export function moneyReviewHTML(r,{choice=true}={}){
 if(!r)return '';const warnings=r.warnings||[];
 return `<section class="money-review ${r.requiresChoice?'needs-choice':warnings.length?'near-budget':''}" data-money-review data-review-token="${h(r.token)}"><h3>${r.requiresChoice?'这笔操作需要你决定':'本次预算与余额影响'}</h3>${warnings.map(x=>`<p class="money-warning"><strong>${h(x.text)}</strong><span>${x.type==='reserve'?`${h(x.date)} 操作后预计剩 ${money(x.projected)}，低于保留金额 ${money(x.limit)}，差额 ${money(x.shortfall)}`:`${h(x.month)}${x.category?' · '+h(x.category):''}预计 ${money(x.projected)} / 预算 ${money(x.limit)}${x.shortfall?'，超出 '+money(x.shortfall):'，已达80%提醒线'}`}</span></p>`).join('')}${r.balancePath?.length?`<p>按当前余额预计，完成这些转出后剩余 <strong>${money(r.balanceAfter)}</strong>。</p>`:''}${r.insufficient?'<p class="budget-danger">按当前余额预测，有步骤资金不足；实际执行时余额不足的步骤仍不会执行。</p>':''}${r.budgets?.length?`<details><summary>查看消费预算计算</summary>${r.budgets.map(b=>`<p>${h(b.month)}：已记录 ${money(b.spent)} + 已计划／预约消费 ${money(b.scheduled)} + 本次 ${money(b.added)} = ${money(b.projected)}${b.enabled?'；预算 '+money(b.budget):'；未设置月预算'}</p>`).join('')}<p>划转、本人互转和理财本金不计消费；已发生账单不会再次扣余额。</p></details>`:''}${r.requiresChoice&&choice?'<label class="budget-once-consent"><input type="checkbox" data-budget-choice required>我已看清超额或保留金额差额，仍选择仅本次继续</label><p class="budget-choice-note">不修改原预算和最低保留设置，仅适用于本页列出的操作与日期。你也可以返回减少金额或取消；预约执行时影响进一步增加会暂停。</p>':''}</section>`;
}
export function budgetAck(host){const r=host.querySelector('[data-money-review]');return r?.querySelector('[data-budget-choice]')?.checked?{budgetAck:r.dataset.reviewToken}:{};}
export function budgetDecisionHTML(d){return d?.choice==='continue-once'?`<p class="budget-decision-record">用户选择仅本次继续 · ${h(new Date(d.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))}<br>${d.warnings.filter(x=>x.requiresChoice).map(x=>h(x.text)+' '+money(x.shortfall)).join('；')}<br>原预算和最低保留设置保持不变。</p>`:'';}
export function budgetOverviewHTML(b){if(!b)return '';const percent=b.budget?Math.min(100,b.spent/b.budget*100):b.over?100:0;return `<section class="budget-overview ${b.over||b.belowReserve?'budget-alert':b.near?'budget-near':''}" aria-label="预算提醒"><div class="budget-heading"><h2>${h(b.month)} 消费预算</h2><button type="button" class="mini-link" data-budget-settings>调整预算与保留金额</button></div>${b.currentMonth&&b.month!==b.currentMonth?`<p class="budget-danger">当前是 ${h(b.currentMonth)}，本月预算尚未设置；下方为 ${h(b.month)} 的记录。</p>`:''}<div class="budget-main-line"><span>已记录消费 <strong>${money(b.spent)}</strong></span><span>${b.enabled?'消费额度 '+money(b.budget):'尚未设置月预算'}</span></div>${b.enabled?`<div class="budget-meter" role="img" aria-label="预算已用${b.budget?Math.round(b.spent/b.budget*100):b.spent?100:0}%"><i style="width:${percent}%"></i></div><p>${b.over?`已超预算 <strong>${money(b.over)}</strong>`:b.near?`已到80%提醒线，还可安排 ${money(b.remaining)}`:`预算内剩余 ${money(b.remaining)}`}</p>`:''}${b.totalBudget!=null?`<p class="budget-total-equation">总预算 ${money(b.totalBudget)} − 保留 ${money(b.reserve)} = 分类消费额度 ${money(b.budget)}</p>`:''}${b.planned?`<p>另有计划／预约消费 ${money(b.planned)}${b.forecastOver?'，按计划预计超预算 '+money(b.forecastOver):''}，尚未计为已发生。</p>`:''}${b.categories.filter(x=>x.near).map(x=>`<p class="budget-category-alert">${h(x.name)} · ${x.over?'已超 '+money(x.over):'接近分类预算'}（${money(x.spent)} / ${money(x.budget)}）</p>`).join('')}${b.belowReserve?`<p class="budget-danger">当前余额低于你设置的最低保留金额 ${money(b.belowReserve)}；下一笔转出前会再次提醒，由你决定。</p>`:''}<details class="quiet-help"><summary>统计说明</summary><p class="budget-scope">${h(b.scope)}</p></details></section>`;}
const categoryColors=['#2e6b60','#a56f4d','#75918a','#577a9c','#ae974f','#8b7d99','#abb3aa'];
const inputMoney=n=>(n/100).toFixed(2).replace(/\.00$/,'');
function parseMoney(value){
 if(!/^\d+(\.\d{1,2})?$/.test(String(value)))throw Error('金额须为非负数，最多两位小数');
 const [whole,fraction='']=String(value).split('.'),n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(n)||n>200000000)throw Error('金额超过可设置范围');
 return n;
}
// Every cent is allocated; the final remainder follows the largest fractional shares.
function distribute(cents,weights){
 const sum=weights.reduce((a,b)=>a+b,0),w=sum?weights:weights.map(()=>1),divisor=sum||weights.length;
 const exact=w.map((n,i)=>({i,value:cents*n/divisor})),result=exact.map(x=>Math.floor(x.value));
 const left=cents-result.reduce((a,b)=>a+b,0);
 exact.sort((a,b)=>(b.value-Math.floor(b.value))-(a.value-Math.floor(a.value))||a.i-b.i);
 for(let i=0;i<left;i++)result[exact[i].i]++;
 return result;
}
export function budgetEditorHTML(p={}, {id='budget-form',cancel=true}={}){
 const total=p.totalBudget??((p.budget||0)+(p.reserve||0));
 return `<form id="${h(id)}" class="budget-editor" data-budget-editor novalidate>
  <div class="allocation-heading"><div><span class="eyebrow">MONTHLY BUDGET</span><h3>总预算与分类分配</h3></div><label>预算月份<input name="month" type="month" value="${h(p.month)}" required></label></div>
  <div class="budget-allocation-layout"><section class="allocation-funds" aria-label="总预算与预留">
   <label for="${h(id)}-total">本月总预算<span class="allocation-money"><span>¥</span><input id="${h(id)}-total" name="totalBudget" inputmode="decimal" value="${inputMoney(total)}" required aria-describedby="${h(id)}-equation"></span></label>
   <label for="${h(id)}-reserve">其中保留金额<span class="allocation-money"><span>¥</span><input id="${h(id)}-reserve" name="reserve" inputmode="decimal" value="${inputMoney(p.reserve||0)}" required></span></label>
   <div class="allocation-equation" id="${h(id)}-equation"><span>总预算 − 保留金额</span><strong data-spendable></strong><small>可分配给下方消费分类</small></div>
   <div class="allocation-strip" aria-hidden="true"></div><p class="allocation-explanation">保留金额包含在总预算内，也作为账户最低保留提醒。保存计划不会冻结或划走资金。</p>
  </section><section class="allocation-categories" aria-label="分类预算"><div class="allocation-table-head"><h4>消费分类</h4><span>预算 / 元</span></div>
   ${categories.map((c,i)=>`<div class="allocation-row" data-allocation-category="${c}"><div><label for="${h(id)}-cat-${i}"><i style="--category-color:${categoryColors[i]}"></i>${c}</label><small data-category-spent></small></div><input id="${h(id)}-cat-${i}" name="cat-${c}" inputmode="decimal" value="${inputMoney(p.categoryBudgets?.[c]||0)}" aria-label="${c}预算（元）" required></div>`).join('')}
   <div class="allocation-tools"><button type="button" class="mini-link" data-allocate-spending>按已记录消费占比分配</button><button type="button" class="mini-link" data-allocate-remainder>余款归入其他</button></div>
  </section></div>
  <div class="allocation-footer"><div role="status" aria-live="polite"><strong data-allocation-status></strong><small data-allocation-detail></small></div><div class="allocation-actions">${cancel?'<button type="button" class="secondary" data-budget-cancel>取消</button>':''}<button type="submit" class="primary" data-budget-save>保存预算</button></div></div>
  <p class="allocation-error" role="alert"></p>
 </form>`;
}
export function bindBudgetEditor(host,{plan={},ledger=[],api,onSaved,onCancel}={}){
 const form=host.matches?.('[data-budget-editor]')?host:host.querySelector('[data-budget-editor]');if(!form)return;
 let working=false;
 const field=n=>form.elements.namedItem(n),q=s=>form.querySelector(s),save=q('[data-budget-save]');
 const validMonth=()=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(field('month').value);
 function values(){const total=parseMoney(field('totalBudget').value),reserve=parseMoney(field('reserve').value),caps=categories.map(c=>parseMoney(field('cat-'+c).value));if(reserve>100000000||total-reserve>100000000||caps.some(n=>n>100000000))throw Error('保留金额或消费预算最高100万元');return {total,reserve,caps,available:total-reserve,allocated:caps.reduce((a,b)=>a+b,0)};}
 const spent=()=>categories.map(c=>ledger.filter(r=>r.account!=='import'&&!String(r.account||'').startsWith('import:')&&r.kind==='expense'&&r.category===c&&r.date?.startsWith(field('month').value)).reduce((n,r)=>n+r.cents,0));
 function update(){
  let v;try{v=values();}catch(e){q('[data-allocation-status]').textContent=e.message;q('[data-allocation-detail]').textContent='请检查金额';form.dataset.allocationState='invalid';q('[data-spendable]').textContent='—';q('.allocation-strip').replaceChildren();save.disabled=true;return;}
  const gap=v.available-v.allocated,recorded=spent(),valid=validMonth()&&v.available>=0&&gap===0;
  form.dataset.allocationState=valid?'balanced':'unbalanced';q('[data-spendable]').textContent=money(v.available);
  q('[data-allocation-status]').textContent=!validMonth()?'请选择预算月份':v.available<0?'保留金额不能超过总预算':gap===0?'分配完成':gap>0?'还可分配 '+money(gap):'已超配 '+money(-gap);
  q('[data-allocation-detail]').textContent=`分类合计 ${money(v.allocated)} / 可分配 ${money(v.available)}`;
  save.disabled=working||!valid;
  q('[data-allocate-remainder]').disabled=working||v.available<0||gap<=0;
  q('[data-allocate-spending]').disabled=working||v.available<0||!validMonth();
  q('.allocation-strip').innerHTML=categories.map((c,i)=>`<i title="${h(c)}" style="background:${categoryColors[i]};width:${v.available>0?Math.min(100,v.caps[i]/v.available*100):0}%"></i>`).join('');
  form.querySelectorAll('[data-allocation-category]').forEach((row,i)=>{const over=Math.max(0,recorded[i]-v.caps[i]),el=row.querySelector('[data-category-spent]');el.textContent=`已花 ${money(recorded[i])}${over?' · 超出 '+money(over):''}`;el.classList.toggle('allocation-over',over>0);});
  q('[role=alert]').textContent='';
 }
 form.addEventListener('input',update);form.addEventListener('change',update);
 q('[data-allocate-remainder]').onclick=()=>{const v=values(),gap=v.available-v.allocated;if(gap>0){field('cat-其他').value=inputMoney(v.caps.at(-1)+gap);update();}};
 q('[data-allocate-spending]').onclick=()=>{const v=values();if(v.available<0)return;const allocation=distribute(v.available,spent());categories.forEach((c,i)=>field('cat-'+c).value=inputMoney(allocation[i]));update();};
 q('[data-budget-cancel]')?.addEventListener('click',()=>{if(!working)onCancel?.();});
 form.onsubmit=async e=>{
  e.preventDefault();if(working)return;
  try{
   const v=values();if(!validMonth())throw Error('请选择预算月份');if(v.available<0||v.available!==v.allocated)throw Error('请先配平：总预算减去保留金额，须等于分类预算合计');
   working=true;if(form.closest('dialog'))form.closest('dialog').dataset.working='true';form.querySelectorAll('input').forEach(x=>x.readOnly=true);q('[data-budget-cancel]')?.setAttribute('disabled','');update();save.textContent='正在保存…';
   await api('/api/personal/budget',{month:field('month').value,totalBudget:v.total,budget:v.available,reserve:v.reserve,categoryBudgets:Object.fromEntries(categories.map((c,i)=>[c,v.caps[i]]))});
   await onSaved?.();
  }catch(err){q('[role=alert]').textContent=err.message;}
  finally{working=false;if(form.closest('dialog'))form.closest('dialog').dataset.working='false';form.querySelectorAll('input').forEach(x=>x.readOnly=false);q('[data-budget-cancel]')?.removeAttribute('disabled');save.textContent='保存预算';if(form.isConnected){const message=q('[role=alert]').textContent;update();q('[role=alert]').textContent=message;}}
 };
 update();return {update};
}
export async function openBudgetSettings(api,onSaved){
 const s=await api('/api/state');
 const d=openDialog({id:'budget-settings-dialog',title:'月度预算分配',wide:true,content:budgetEditorHTML(s.personal.plan,{id:'budget-settings-form'})});
 bindBudgetEditor(d,{plan:s.personal.plan,ledger:s.personal.ledger,api,onSaved:async()=>{d.close();await onSaved?.();},onCancel:()=>d.close()});return d;
}

export function bindBudgetSettings(host,api,onSaved){host.querySelectorAll('[data-budget-settings]').forEach(b=>b.onclick=()=>openBudgetSettings(api,onSaved));}
export async function openTransferClassification(id,api,onSaved){const state=await api('/api/state'),current=state.personal.ledger.find(x=>x.id===id);if(!current)throw Error('原转账不存在，请刷新账单');let preview=null,working=false;const d=openDialog({id:'transfer-classification',title:'调整转账的统计用途',content:`<p>只调整账单和预算分类，不重复转账，原始回执保留。</p>${useFields(current)}<button type="button" class="secondary" data-use-preview>查看预算影响</button><div data-use-impact></div><p role="alert"></p>`});bindUseFields(d,()=>{preview=null;d.querySelector('[data-use-impact]').innerHTML='';});d.querySelector('[data-use-preview]').onclick=async()=>{if(working)return;working=true;try{preview=await api('/api/transfers/classify-preview',{id,...readUse(d.querySelector('.transfer-use'))});d.querySelector('[data-use-impact]').innerHTML=moneyReviewHTML(preview.review)+'<button type="button" class="primary" data-use-save>确认保存统计用途</button>';d.querySelector('[data-use-save]').onclick=save;}catch(e){d.querySelector('[role=alert]').textContent=e.message;}finally{working=false;}};async function save(){if(working||!preview)return;if(preview.review?.requiresChoice&&!d.querySelector('[data-budget-choice]')?.checked){d.querySelector('[role=alert]').textContent='请先核对预算影响，并选择是否仅本次继续。';return;}working=true;d.dataset.working='true';try{await api('/api/transfers/classify',{id,...preview.use,...budgetAck(d)});d.close();await onSaved?.();}catch(e){d.querySelector('[role=alert]').textContent=e.message;preview=null;d.querySelector('[data-use-impact]').innerHTML='';}finally{working=false;d.dataset.working='false';}}return d;}
