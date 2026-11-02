import {openDialog} from './dialog.js';
import {showPrompt} from './security.js';
import {reviewBankPlan} from './plan-dialog.js';
import {openRiskQuiz} from './wealth-assistant.js';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥'+(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
export function tradeAmount(value){const text=String(value).trim();if(!/^\d+(\.\d{1,2})?$/.test(text))throw Error('请输入有效金额，最多两位小数');const [a,b='']=text.split('.'),cents=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents<=0||cents>100000000)throw Error('单次金额须在0.01至1,000,000元之间');return cents;}
export function investmentIssue(bank,product,kind,cents,now=Date.now()){
 if(kind==='redeem'){const held=bank.holdings[product.id]||0;return cents>held?{title:'赎回金额超过持仓',lines:['可赎回本金 '+money(held),'本次赎回 '+money(cents)]}:null;}
 const card=bank.cards.find(x=>x.id==='main');if(!card||card.status!=='active')return {title:'付款卡暂不可用',lines:['请先在卡片页面解锁或解除挂失，再继续购买。']};
 if(cents<product.min)return {title:'未达到起购金额',lines:['本产品 '+money(product.min)+' 起购','本次金额 '+money(cents)]};
 if(cents>bank.balance)return {title:'余额不足',lines:['可用余额 '+money(bank.balance),'本次购买 '+money(cents),'还差 '+money(cents-bank.balance)]};
 if(cents>card.limit)return {title:'超过单笔限额',lines:['当前单笔限额 '+money(card.limit),'本次购买 '+money(cents)]};
 if(!bank.risk||now-bank.risk.at>=365*86400000)return {title:'请先完成风险测评',lines:['购买前需要有效的风险承受能力测评。'],risk:true};
 if(bank.risk.level<product.risk)return {title:'风险等级不匹配',lines:['你的风险等级 R'+bank.risk.level,'本产品风险等级 R'+product.risk,'暂不能购买高于当前承受等级的产品。']};return null;
}
export async function openProductOrder(productId,api,onChanged,{kind='buy'}={}){
 const buying=kind==='buy',verb=buying?'购买':'赎回',d=openDialog({id:'product-order-dialog',title:verb+'基金',content:'<p role="status">正在读取账户信息…</p>'});let bank,product,draft='',working=false;
 const body=d.querySelector('.dialog-body');
 function paint(){if(!d.isConnected)return;product=bank.products.find(p=>p.id===productId);if(!product){body.textContent='产品暂不可用，请返回产品列表。';return;}
  const riskMissing=buying&&(!bank.risk||Date.now()-bank.risk.at>=365*86400000),riskLow=buying&&bank.risk&&!riskMissing&&bank.risk.level<product.risk;
  body.innerHTML=`<span class="account-mode">模拟交易</span><h3>${h(product.name.replace(/ · 模拟$/,''))}</h3><p class="muted">${product.code?h(product.code)+' · ':''}R${product.risk}${buying?' · '+money(product.min)+' 起购':''}</p>${riskMissing||riskLow?`<section class="order-risk-note"><h3>${riskMissing?'购买前请完成风险测评':'风险等级不匹配'}</h3><p>${riskMissing?'完成测评后，可继续填写购买金额。':'你的风险等级为 R'+bank.risk.level+'，本产品为 R'+product.risk+'，暂不能购买。'}</p><button type="button" class="${riskMissing?'primary':'secondary'}" data-order-risk>${riskMissing?'开始风险测评':'查看风险测评'}</button></section>`:`<form data-product-order><label>${verb}金额（元）<input name="amount" inputmode="decimal" autocomplete="off" required placeholder="${buying?(product.min/100).toFixed(2):'请输入赎回金额'}" value="${h(draft)}"></label><p class="order-available">${buying?'可用余额':'可赎回本金'} <strong>${money(buying?bank.balance:bank.holdings[product.id]||0)}</strong></p><details class="quiet-help"><summary>交易说明</summary><p>本次为模拟${verb}，按本金记账，不使用真实净值成交、不计算实际收益。${buying?'购买后会从账户余额扣除对应本金。':'赎回后约'+product.days+'个自然日到账，不会立即增加可用余额。'}</p></details><button type="submit" class="primary">下一步 · 核对${verb}</button></form>`}`;
  body.querySelector('[data-order-risk]')?.addEventListener('click',()=>openRiskQuiz(api,async()=>{bank=await api('/api/banking');paint();Promise.resolve(onChanged?.()).catch(()=>{});}));
  body.querySelector('form')?.addEventListener('submit',submit);
 }
 async function submit(e){e.preventDefault();if(working)return;draft=new FormData(e.target).get('amount');let cents;try{cents=tradeAmount(draft);}catch(err){showPrompt('请检查金额',[err.message],{confirmLabel:'修改金额',onConfirm:()=>body.querySelector('[name=amount]')?.focus()});return;}
  working=true;d.dataset.working='true';body.querySelectorAll('input,button').forEach(x=>x.disabled=true);const button=body.querySelector('button[type=submit]');if(button)button.textContent='正在核对…';
  try{bank=await api('/api/banking');product=bank.products.find(p=>p.id===productId);if(!product)throw Error('产品暂不可用');const issue=investmentIssue(bank,product,kind,cents);if(issue){if(issue.risk)paint();showPrompt(issue.title,issue.lines,{confirmLabel:issue.risk?'返回测评':'返回修改',onConfirm:()=>body.querySelector('[name=amount]')?.focus()});return;}
   const plan=await api('/api/banking/plan',{title:verb+' · '+product.name.replace(/ · 模拟$/,''),steps:[{kind,product:product.id,cents,...(buying?{reserve:0}:{})}]});d.close();Promise.resolve(onChanged?.()).catch(()=>{});await reviewBankPlan(plan.id,api,onChanged);
  }catch(err){showPrompt('暂未完成'+verb,[err.message,'请核对待处理记录后继续。']);}
  finally{working=false;d.dataset.working='false';if(d.isConnected)paint();}
 }
 try{bank=await api('/api/banking');paint();}catch(err){if(d.isConnected)body.textContent=err.message;}return d;
}
