import {openDialog} from './dialog.js';
import {requestJSON} from './request.js';

export function openReviewSpace(onCreated){
 const bytes=crypto.getRandomValues(new Uint8Array(44));
 let username='demo_'+[...bytes.slice(0,12)].map(n=>n.toString(16).padStart(2,'0')).join('');
 let password=btoa(String.fromCharCode(...bytes.slice(12))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');bytes.fill(0);
 let saved=false;
 const dialog=openDialog({id:'review-space-dialog',title:'创建独立体验账户',content:`<p>这是你的独立模拟账户，余额、账单和安全设置与其他访问者分开保存。全部资金均为模拟。</p><div class="review-credentials"><label>体验账号<input id="review-username" readonly autocomplete="off" spellcheck="false"></label><label>登录密码<input id="review-password" readonly autocomplete="off" spellcheck="false"></label></div><p class="muted">先保存登录资料。支付密码与手机验证器进入后由你设置，请勿转发登录资料或把它们放入参赛材料。</p><div class="actions"><button type="button" class="secondary" id="review-copy">复制登录资料</button><button type="button" class="secondary" id="review-download">下载登录资料</button></div><p id="review-space-feedback" role="status">保存资料后即可创建。关闭窗口前不会创建账户。</p><button type="button" class="primary" id="review-create" disabled>创建并进入</button>`});
 dialog.querySelector('#review-username').value=username;dialog.querySelector('#review-password').value=password;
 const button=dialog.querySelector('#review-create'),feedback=dialog.querySelector('#review-space-feedback');
 const information=()=>`FinGuard 独立模拟账户\n地址：${location.origin}/\n账号：${username}\n密码：${password}\n\n全部资金与交易均为模拟。支付密码和手机验证器需自行设置。请妥善保存，不要转发。\n`;
 const markSaved=()=>{saved=true;button.disabled=false;feedback.textContent='登录资料已保存。创建后可以设置自己的支付密码与手机验证器。';};
 dialog.querySelector('#review-copy').onclick=async()=>{try{await navigator.clipboard.writeText(information());markSaved();}catch{feedback.textContent='未能复制，请使用下载登录资料。';}};
 dialog.querySelector('#review-download').onclick=()=>{
  const url=URL.createObjectURL(new Blob([information()],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='FinGuard-体验登录资料.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);markSaved();
 };
 button.onclick=async()=>{
  if(!saved||dialog.dataset.working==='true')return;
  dialog.dataset.working='true';button.disabled=true;button.textContent='正在创建…';
  try{
   const result=await requestJSON('/api/auth/demo-space',{username,password});
   dialog.dataset.working='false';dialog.close();await onCreated(result.user);
  }catch(error){
   if(!dialog.isConnected)return;
   feedback.textContent=error.timeout?'暂未收到创建结果。可用已保存的资料登录，或在这里重试；同一资料不会创建第二个账户。':error.message;
   dialog.dataset.working='false';button.disabled=false;button.textContent='重试创建并进入';
  }
 };
 dialog.addEventListener('close',()=>{username='';password='';},{once:true});
 return dialog;
}
