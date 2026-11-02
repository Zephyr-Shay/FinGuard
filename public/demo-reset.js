import {openDialog} from './dialog.js';
import {openSecurityDialog,otpField} from './security.js';
export async function openDemoReset(api,onReset=async()=>{}){
 const d=openDialog({id:'demo-reset-dialog',title:'重置演示并重新设置安全验证',content:'<p role="status">正在读取当前安全设置…</p>'});
 try{
  const status=await api('/api/auth/payment');if(!d.isConnected||!d.open)return d;
  d.querySelector('.dialog-body').insertAdjacentHTML('beforeend',`<p>当前账户将恢复初始样例，并清除支付密码和手机验证器绑定。登录密码保留，需要保留的业务记录请先导出。</p><form id="demo-reset-form"><label>当前登录密码<input name="loginPassword" type="password" autocomplete="current-password" required maxlength="128"></label>${status.mfa?otpField():''}${status.mfa?'<p class="muted">先验证当前手机动态码，再解除绑定。原验证器不可用时，请创建独立体验账户或联系管理员核验。</p>':''}<p role="alert" data-reset-error></p><div class="actions"><button type="button" class="secondary" data-reset-cancel>保留当前演示</button><button class="primary" data-reset-confirm>确认重置并重新设置</button></div></form>`);
  d.querySelector('[role=status]').remove();const form=d.querySelector('form#demo-reset-form');
  d.querySelector('[data-reset-cancel]').onclick=()=>d.close();
  form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('[data-reset-confirm]');if(submit.disabled)return;submit.disabled=true;d.dataset.working='true';form.querySelector('[data-reset-cancel]').disabled=true;submit.textContent='正在重置…';const out=form.querySelector('[data-reset-error]');out.textContent='';
   try{const data=Object.fromEntries(new FormData(form));await api('/api/reset',{confirm:'RESET_DEMO',...data});form.reset();d.close();let refreshFailed=false;try{await onReset();}catch{refreshFailed=true;}
    const done=openDialog({id:'demo-reset-complete',title:'演示已重置，请重新设置',content:`<p>支付密码和手机验证器绑定已清除，小额免密已关闭。</p><p>重新设置完成前，转账、理财及安全操作仍需完成相应验证。</p>${refreshFailed?'<p>账户信息暂未刷新，请重新载入页面。重置已完成，不要重复提交。</p>':''}<div class="actions"><button type="button" class="secondary" data-setup-later>稍后设置</button><button type="button" class="primary" data-setup-now>立即设置支付密码与验证器</button></div>`});
    done.querySelector('[data-setup-later]').onclick=()=>done.close();done.querySelector('[data-setup-now]').onclick=()=>{done.close();openSecurityDialog(api);};
   }catch(error){out.textContent=error.message;}finally{d.dataset.working='false';form.querySelector('[data-reset-cancel]').disabled=false;submit.disabled=false;submit.textContent='确认重置并重新设置';}
  };
 }catch(error){const out=d.querySelector('[role=status]');if(out)out.textContent='安全设置未能读取：'+error.message;}
 return d;
}
