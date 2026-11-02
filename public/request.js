// A timed-out write may already have completed. Never retry it automatically.
export function requestTimeout(path,write=false){
 if(/^\/api\/market(?:[?]|$)/.test(path))return 60000;
 return write&&/^\/api\/(?:plan$|advice$|analysis\/chat$|expense-chat\/(?:start|reply)$|(?:wealth|funding)-assistant\/(?:start|reply)$|wealth\/propose$|market\/analyze$|import\/analyze$|analysis\/advice$|chatgpt\/)/.test(path)?60000:write?12000:8000;
}
export async function requestJSON(path,data,options={}){
 if(typeof document!=='undefined'&&data!==undefined&&/^\/api\/(?:plan$|advice$|analysis\/(?:chat|advice)$|expense-chat\/(?:start|reply)$|(?:wealth|funding)-assistant\/(?:start|reply)$|wealth\/propose$|market\/analyze$|import\/analyze$)/.test(path)){
  const settings=await performRequest('/api/ai/settings',undefined,options);
  if(settings.available&&!settings.consented){const {askAIConsent}=await import('./ai-privacy.js');const agreed=await askAIConsent(settings,(p,d)=>performRequest(p,d,options));if(!agreed)throw Object.assign(Error('尚未启用外部AI，可继续手动办理业务。'),{code:'AI_CONSENT_REQUIRED'});}
 }
 return performRequest(path,data,options);
}
async function performRequest(path,data,{userId='',timeoutMs=requestTimeout(path,data!==undefined),fetcher=globalThis.fetch}={}){
 const controller=new AbortController();let timer;
 const timeoutError=()=>{const e=Error(data===undefined?'读取超时，请稍后重新查询。':'未及时收到处理结果，请先核对原操作记录，不要重复提交。');e.timeout=true;e.code='REQUEST_TIMEOUT';return e;};
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(timeoutError());},timeoutMs);});
 try{return await Promise.race([expired,(async()=>{
  const res=await fetcher(path,{signal:controller.signal,...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...(userId?{'X-FinGuard-User':userId}:{})},body:JSON.stringify(data)})});
  let result;try{result=await res.json();}catch{const e=Error('服务器响应未能读取，请先核对操作结果。');if(!res.ok)e.status=res.status;throw e;}
  if(!res.ok){const e=Error(result.error||'操作未完成');e.status=res.status;if(typeof result.code==='string')e.code=result.code;throw e;}return result;
 })()]);}catch(e){if(controller.signal.aborted)throw timeoutError();throw e;}finally{clearTimeout(timer);}
}
