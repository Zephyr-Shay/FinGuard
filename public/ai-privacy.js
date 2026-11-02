import {openDialog} from './dialog.js';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function askAIConsent(settings,api){
 return new Promise(resolve=>{
  const d=openDialog({id:'ai-data-dialog',title:'外部AI数据使用',content:`<p>提供方：<strong>${h(settings.provider)}</strong></p><p>为理解需求和分析资金，你的问题、近期对话，以及本次所需的账单、余额、联系人名称和风险资料，会发送给该提供方。</p><p>常见口令字段、证件号、银行卡号、手机号和邮箱会先过滤；请勿在聊天中输入支付密码或验证码。过滤无法识别所有个人信息。</p>${settings.privacyUrl?`<p><a href="${h(settings.privacyUrl)}" target="_blank" rel="noopener noreferrer">阅读提供方隐私政策 ↗</a></p>`:'<p>提供方尚未配置隐私政策链接，请向网站管理员确认数据处理规则。</p>'}<p>提供方的留存和训练使用规则以其政策及你与运营方的约定为准。你可在“账户安全”中撤回，撤回会停止后续发送，无法收回已经发送的资料。</p><p>暂不启用，也可继续手动转账和管理账单、卡片。</p><p role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-ai-decline>暂不启用</button><button type="button" class="primary" data-ai-agree>同意并继续</button></div>`});
  let agreed=false;d.addEventListener('close',()=>resolve(agreed),{once:true});
  d.querySelector('[data-ai-decline]').onclick=()=>d.close();
  d.querySelector('[data-ai-agree]').onclick=async()=>{const b=d.querySelector('[data-ai-agree]');b.disabled=true;try{await api('/api/ai/settings',{enabled:true});agreed=true;d.close();}catch(e){d.querySelector('[role=alert]').textContent=e.message;b.disabled=false;}};
 });
}
