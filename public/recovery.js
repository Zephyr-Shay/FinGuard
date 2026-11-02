const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function openPaymentRecovery(api,status,onSaved){
 if(document.querySelector('#payment-recovery'))return;
 const d=document.createElement('dialog');d.id='payment-recovery';d.setAttribute('aria-labelledby','recovery-title');let stage=status.mfa?'login':'unavailable',loginPassword='',newPin='',busy=false,expires=0;
 const labels=[['login','登录核验'],['pin','新支付密码'],['otp','手机验证']];
 function clear(){loginPassword='';newPin='';expires=0;}
 function close(){if(busy)return;clear();d.close();d.remove();}
 function lock(value){busy=value;d.querySelectorAll('button,input').forEach(n=>n.disabled=value);d.setAttribute('aria-busy',String(value));}
 function render(message='',resetAt=''){
  d.innerHTML=`<div class="dialog-body"><span class="eyebrow">账户安全</span>${['login','pin','otp'].includes(stage)?`<ol class="recovery-progress" aria-label="重设支付密码进度">${labels.map(([key,label],i)=>`<li ${stage===key?'aria-current="step"':''}><span>${i+1}</span>${label}</li>`).join('')}</ol>`:''}<h2 id="recovery-title">${({login:'忘记支付密码',pin:'设置新支付密码',otp:'验证并重设',success:'支付密码已重设',unknown:'重设结果待核对',unavailable:'暂不能自助重设'})[stage]}</h2>
  ${stage==='login'?'<p>使用当前登录密码和已绑定的手机验证器核验身份，无需原支付密码。</p><form id="recovery-form"><label>当前登录密码<input name="loginPassword" type="password" autocomplete="current-password" maxlength="128" required></label><button class="primary">下一步 · 设置新密码</button></form>':''}
  ${stage==='pin'?'<p>请输入新的6位支付密码，避免重复或简单连续数字。</p><form id="recovery-form"><label>新支付密码<input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label><label>再次输入新支付密码<input name="repeat" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label><button class="primary">下一步 · 手机验证</button></form>':''}
  ${stage==='otp'?'<p>打开已绑定的手机验证器，输入当前动态码。完成后旧支付密码立即失效，其他设备会退出登录。</p><form id="recovery-form"><label>手机验证器动态验证码<input name="totp" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required placeholder="6位动态数字"></label><button class="primary">验证并重设支付密码</button></form><button class="mini-link" id="recovery-edit">返回修改新密码</button>':''}
  ${stage==='success'?`<p>新支付密码已生效，旧密码已失效。原支付密码的临时锁定已解除。</p><p>其他设备已退出登录，当前设备可继续使用。已确认的定时转账保持原安排。原操作不会自动继续，请重新核对后办理。</p><p>完成时间：${h(stamp(resetAt))}（北京时间）</p>`:''}
  ${stage==='unknown'?'<p>未收到服务器的确定结果，请先查看处理记录中的“重设支付密码”。不要把网络错误当成重设失败，也不要连续重复提交。</p><a class="mini-link" href="/banking.html#history">查看处理记录 →</a>':''}
  ${stage==='unavailable'?'<p>当前账号未绑定手机验证器，无法仅凭登录密码重设支付密码。请联系网站管理员核实身份。</p>':''}
  <p id="recovery-error" role="alert">${h(message)}</p>${['login','pin','otp','unavailable'].includes(stage)?'<p class="muted recovery-help">手机验证器也丢失了？请联系网站管理员核实身份，网页不能直接跳过验证。</p>':''}<button class="text-button" id="recovery-close">${['success','unknown'].includes(stage)?'完成':'取消'}</button></div>`;
  d.querySelector('#recovery-close').onclick=close;d.querySelector('#recovery-form')?.addEventListener('submit',submit);d.querySelector('#recovery-edit')?.addEventListener('click',()=>{newPin='';stage='pin';render();});d.querySelector('input')?.focus();
 }
 async function submit(e){e.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(e.target));lock(true);let sent=false;try{
  if(stage!=='login'&&Date.now()>=expires){clear();stage='login';render('核验已超时，请重新输入登录密码。');return;}
  if(stage==='login'){await api('/api/auth/payment/reset/check',{loginPassword:data.loginPassword});loginPassword=data.loginPassword;expires=Date.now()+300000;stage='pin';render();return;}
  if(stage==='pin'){if(data.newPin!==data.repeat)throw Error('两次支付密码不一致');if(!/^\d{6}$/.test(data.newPin)||/^(\d)\1{5}$/.test(data.newPin)||['123456','654321'].includes(data.newPin))throw Error('请使用6位数字，避免重复或简单连续数字');newPin=data.newPin;stage='otp';render();return;}
  if(stage==='otp'){sent=true;const result=await api('/api/auth/payment/reset',{loginPassword,newPin,totp:data.totp});clear();stage='success';let note='';try{await onSaved();}catch{note='密码已重设，页面状态刷新失败，请重新载入。';}render(note,result.resetAt);}
 }catch(error){if(sent&&(!error.status||error.status>=500)){clear();stage='unknown';render();}else{if(stage==='otp')d.querySelector('[name=totp]').value='';d.querySelector('#recovery-error').textContent=error.message;}}finally{if(d.isConnected)lock(false);}}
 d.addEventListener('cancel',e=>{e.preventDefault();close();});d.addEventListener('close',()=>{clear();d.remove();});document.body.append(d);render();d.showModal();return d;
}

let recoveryBound=false,recoveryOpening=false;
export function bindPaymentRecovery(api,onSaved){
 if(recoveryBound)return;recoveryBound=true;
 document.addEventListener('click',async event=>{const button=event.target.closest?.('[data-payment-recover]');if(!button)return;event.preventDefault();event.stopPropagation();if(recoveryOpening||document.querySelector('#payment-recovery'))return;recoveryOpening=true;button.disabled=true;
 try{const status=await api('/api/auth/payment');document.querySelectorAll('input[type=password]').forEach(input=>input.value='');const previous=button.closest('dialog');if(previous)previous.close();openPaymentRecovery(api,status,async()=>{document.querySelectorAll('input[type=password]').forEach(input=>input.value='');await onSaved();});}
 catch(error){let output=button.parentElement.querySelector('[data-recovery-launch-error]');if(!output){output=document.createElement('span');output.dataset.recoveryLaunchError='';output.setAttribute('role','alert');button.parentElement.append(output);}output.textContent=error.message;}
 finally{recoveryOpening=false;if(button.isConnected)button.disabled=false;}});
}
