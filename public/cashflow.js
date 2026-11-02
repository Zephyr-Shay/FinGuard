import {openDialog} from './dialog.js';
import {reviewBankPlan} from './plan-dialog.js';
import {openFundingAssistant} from './funding.js';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥'+(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=n=>new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function cashflowEntryHTML(obs){const first=obs?.alerts?.[0];if(!first)return '';return `<section class="cashflow-alert" aria-label="预计资金缺口提醒"><span class="eyebrow">未来 ${obs.days} 天 · 已知付款</span><h2>${first.opening?'当前余额低于保留底线':h(first.date)+' 预计'+(first.kind==='insufficient'?'资金不足':'低于保留底线')}</h2><p>${first.kind==='insufficient'?'预计余额不足 '+money(Math.max(0,-first.after)):'距离保留底线还差 '+money(first.shortfall)}${first.uncertain?' · 有同日同额事项，需核对':''}</p><button type="button" class="secondary" data-open-cashflow>查看日期与相关事项 →</button></section>`;}
export async function openCashflowReview(api,reload){
 const d=openDialog({id:'cashflow-dialog',title:'未来资金核对',wide:true,content:'<p role="status">正在核对已知付款…</p>'});
 async function load(){try{const o=await api('/api/cashflow');if(!d.isConnected)return;
  d.querySelector('.dialog-body').innerHTML=`<div class="cashflow-summary"><div><span>当前可用余额</span><strong>${money(o.balance)}</strong></div><div><span>账户保留底线</span><strong>${money(o.floor)}</strong></div></div><p>${h(o.from)} — ${h(o.until)} · 核对于 ${stamp(o.checkedAt)}</p>${!o.alerts.length?'<p class="cashflow-clear">按已记录事项，暂未发现未来 '+o.days+' 天资金缺口。</p>':''}${o.alerts.some(x=>x.opening)?'<p class="funding-question">当前余额已低于保留底线 '+money(o.floor-o.balance)+'。调整偏好不会增加余额。</p>':''}<ol class="cashflow-timeline">${o.timeline.map(x=>`<li class="${x.shortfall?'cashflow-gap':''}"><div class="editorial-heading"><h3>${h(x.date)}</h3><strong>预计余额 ${money(x.after)}</strong></div><p>当日已知支出 ${money(x.cents)}${x.shortfall?' · '+(x.after<0?'资金不足 '+money(-x.after)+'；':'')+'距离保留底线还差 '+money(x.shortfall):''}</p><ul>${x.items.map(i=>`<li><span><strong>${h(i.title)}</strong><small>${h(i.source)}</small></span><span>${money(i.cents)}</span>${i.planId?'<button type="button" class="mini-link" data-cashflow-plan="'+h(i.planId)+'">核对预约</button>':''}</li>`).join('')}</ul>${x.uncertain?'<p class="funding-warning">这一天有同额事项，暂按不同记录合计。请核对是否重复；系统不会擅自删减。</p>':''}</li>`).join('')||'<li>观察区间内暂无已记录付款。</li>'}</ol><p class="muted">${h(o.scope)}</p><div class="actions"><button type="button" class="primary" data-cashflow-discuss>和助手商量调整</button><button type="button" class="secondary" data-cashflow-refresh>重新核对</button></div><p role="alert" data-cashflow-error></p>`;
  d.querySelectorAll('[data-cashflow-plan]').forEach(b=>b.onclick=()=>reviewBankPlan(b.dataset.cashflowPlan,api,async()=>{await reload();await load();}).catch(e=>{d.querySelector('[data-cashflow-error]').textContent=e.message;}));
  d.querySelector('[data-cashflow-refresh]').onclick=load;
  d.querySelector('[data-cashflow-discuss]').onclick=()=>{const first=o.alerts[0],message=first?'请解释 '+first.date+' 的预计资金缺口 '+money(first.shortfall)+'，结合已知付款提出调整建议。先只解释，不新增付款，也不修改或执行安排。':'请结合已记录付款解释未来资金余量，先不修改或执行安排。';d.close();openFundingAssistant(api,reload,{message});};
 }catch(e){if(d.isConnected)d.querySelector('.dialog-body').textContent='暂时无法核对：'+e.message;}}
 await load();return d;
}
