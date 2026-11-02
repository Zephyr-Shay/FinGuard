const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let serial=0;
// Native modal dialogs keep keyboard focus and the original page in place.
export function openDialog({id='detail-dialog-'+(++serial),title,content='',wide=false}={}){
 const old=document.getElementById(id);if(old?.open)old.close();old?.remove();
 const trigger=document.activeElement,d=document.createElement('dialog');d.id=id;d.className='interaction-dialog'+(wide?' dialog-wide':'');d.setAttribute('aria-labelledby',id+'-title');
 d.innerHTML=`<header class="interaction-head"><h2 id="${h(id)}-title">${h(title)}</h2><button type="button" class="secondary" data-dialog-close aria-label="关闭窗口">关闭</button></header><div class="dialog-body">${content}</div>`;
 const close=d.querySelector('[data-dialog-close]');close.onclick=()=>{if(d.dataset.working!=='true')d.close();};d.addEventListener('cancel',e=>{if(d.dataset.working==='true')e.preventDefault();});
 d.addEventListener('close',()=>{d.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});
 document.body.append(d);d.showModal();return d;
}
