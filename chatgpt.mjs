import {randomBytes,randomUUID,createHash,createPublicKey,verify} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const random=()=>randomBytes(32).toString('base64url');
const fail=message=>{throw new Error(message);};
export class LoginError extends Error {constructor(code,message){super(message);this.code=code;}}
const loginFail=(code,message)=>{throw new LoginError(code,message);};
export function loginFailure(error){return error instanceof LoginError?{code:error.code,message:error.message}:{code:'LOGIN_INTERNAL',message:'登录处理发生异常。请返回后重新登录；若重复出现，请提供此错误编号。'};}
export function validateIdentity(jwt,keys,client,nonce,now=Date.now()) {
  if(typeof jwt!=='string'||jwt.length>20000)fail('登录身份无效');
  const parts=jwt.split('.');if(parts.length!==3)fail('登录身份无效');
  const header=JSON.parse(Buffer.from(parts[0],'base64url'));
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  const key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(header.alg!=='RS256'||header.crit||!key||!verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))fail('登录签名校验失败');
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==issuer||!audiences.includes(client)||(audiences.length>1&&claims.azp!==client)||typeof claims.sub!=='string'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp<=now/1000||!Number.isFinite(claims.iat)||claims.iat>now/1000+5||(claims.nbf&&claims.nbf>now/1000+5)||claims.nonce!==nonce)fail('登录身份或有效期校验失败');
  return claims;
}
export async function readResponse(response) {
  if(!response.ok)fail(`ChatGPT 调用失败（${response.status}），未执行操作。请检查授权或账号额度。`);
  let buffer='',text='',completed=false,total=0;const decoder=new TextDecoder();
  for await(const chunk of response.body){total+=chunk.length;if(total>1000000)fail('模型响应过长');buffer+=decoder.decode(chunk,{stream:true}).replace(/\r/g,'');
    let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!data||data==='[DONE]')continue;
      const event=JSON.parse(data);if(['error','response.failed','response.incomplete'].includes(event.type))fail('ChatGPT 未完成回答，请检查额度后重试；未执行任何操作。');
      if(event.type==='response.output_text.delta'){text+=event.delta;if(text.length>8000)fail('模型输出过长');}
      if(event.type==='response.completed'){if(event.response?.status!=='completed')fail('模型未完成回答');completed=true;}
    }
  }
  if(!completed)fail('模型连接中断，未执行任何操作');return text;
}
export class ChatGPTConnection {
  constructor(folder,port,fetcher=(...args)=>fetch(...args)) {this.port=port;this.fetch=fetcher;const path=join(folder,'chatgpt-host.json');this.host=existsSync(path)?JSON.parse(readFileSync(path,'utf8')).host:`urn:uuid:${randomUUID()}`;if(!existsSync(path))writeFileSync(path,JSON.stringify({host:this.host}));this.epoch=0;this.session=null;this.pending=new Map();this.verified=false;this.model='';this.models=[];}
  status(){return {connected:Boolean(this.session&&this.session.expires>Date.now()),verified:this.verified,email:this.session?.email||'',model:this.model,models:this.models};}
  start(){
    for(const [id,p] of this.pending)if(p.expires<=Date.now())this.pending.delete(id);
    if(this.pending.size>=8)loginFail('LOGIN_TOO_MANY','已有多个登录窗口，请先完成其中一个，或等待10分钟后重试。');
    const state=random(),nonce=random(),verifier=random();
    const p={state,nonce,verifier,epoch:this.epoch,expires:Date.now()+600000,redirect:`http://127.0.0.1:${this.port}/auth/callback`};
    this.pending.set(state,p);
    const url=new URL(issuer+'/api/accounts/authorize');url.search=new URLSearchParams({client_id:'dynamic_agent_client',agent_name_hint:'FinGuard',ext_agent_host_id:this.host,response_type:'code',redirect_uri:p.redirect,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});return {url:url.href};
  }
  async loginJSON(url,options,stage){
    let r;try{r=await this.fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{loginFail(stage+'_NETWORK','连接官方授权服务失败或超时。请检查网络后返回重新登录。');}
    let data;try{data=await r.json();}catch{loginFail(stage+'_FORMAT',`官方授权接口返回了非JSON内容（HTTP ${r.status}），可能是网络中间页面或服务异常。请稍后重新登录。`);}
    if(!r.ok){const code=typeof data.error==='string'?data.error:data.error?.code;
      if(code==='invalid_grant')loginFail('LOGIN_INVALID_GRANT','本次授权码已失效或已被使用。请返回发起全新登录，不要刷新旧回调页面。');
      if(code==='unsupported_country_region_territory')loginFail('LOGIN_REGION','官方服务拒绝了当前地区的请求。请检查该服务在你所在地的可用性。');
      loginFail(stage+'_HTTP',`官方授权服务返回 HTTP ${r.status}。请稍后重新登录；若反复出现，请提供此编号。`);
    }return data;
  }
  async callback(params){
    if(['state','code','client_id','error'].some(k=>params.getAll(k).length>1))loginFail('LOGIN_PARAMETERS','登录回调参数重复，请返回重新登录。');
    const state=params.get('state'),p=this.pending.get(state);
    if(!p)loginFail('LOGIN_STATE','找不到对应登录请求：程序可能重启过，或此回调已使用。请返回发起全新登录，不要刷新旧页面。');
    if(p.expires<=Date.now()){this.pending.delete(state);loginFail('LOGIN_EXPIRED','登录等待已超过10分钟，请返回重新登录。');}
    this.pending.delete(state);
    if(params.has('error'))loginFail('LOGIN_DENIED','未完成官方授权。请返回重新登录并检查授权选项。');
    const client=params.get('client_id'),code=params.get('code');
    if(!client||client==='dynamic_agent_client'||!code)loginFail('LOGIN_INCOMPLETE','官方回调缺少授权码或注册标识，请返回重新登录。');
    const data=await this.loginJSON(issuer+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client,code,code_verifier:p.verifier,redirect_uri:p.redirect,resource})},'TOKEN');
    const keys=await this.loginJSON(issuer+'/.well-known/jwks.json',{},'IDENTITY_KEYS');
    let identity;try{identity=validateIdentity(data.id_token,keys.keys,client,p.nonce);}catch{loginFail('LOGIN_IDENTITY','官方身份签名、账号或有效期校验未通过。请确认电脑时间准确后重新登录；系统未跳过安全校验。');}
    const scopes=String(data.scope||'').split(' ');if(!scopes.includes('chatgpt.tokens.use.direct')||!scopes.includes('resource.invoke')||!data.access_token||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0)loginFail('LOGIN_SCOPE','尚未获得有效的ChatGPT模型使用授权，请重新检查授权选项。');
    if(p.epoch!==this.epoch)loginFail('LOGIN_CANCELLED','本次登录已取消，或另一个登录已完成。请返回查看当前连接状态。');
    this.session={token:data.access_token,email:identity.email||'',expires:Date.now()+data.expires_in*1000};this.verified=false;this.models=[];this.model='';
    this.epoch++;this.pending.clear();
  }
  disconnect(){this.epoch++;this.session=null;this.pending.clear();this.models=[];this.model='';this.verified=false;}
  async request(path,body){if(!this.status().connected)fail('请先使用 ChatGPT 登录；登录可能已过期');return this.fetch(resource+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${this.session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
  async catalog(){const r=await this.request('/models');if(!r.ok)fail('暂时无法获取账号模型列表，请稍后重试');const data=await r.json();this.models=(data.models||[]).filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({slug:m.slug,name:m.display_name||m.slug}));if(!this.models.length)fail('账号未返回可用模型');if(!this.models.some(m=>m.slug===this.model))this.model=this.models[0].slug;return this.status();}
  select(model){if(!this.models.some(m=>m.slug===model))fail('请从账号可用模型中选择');this.model=model;this.verified=false;return this.status();}
  async infer(instructions,input){const session=this.session;if(!this.model)await this.catalog();const result=await readResponse(await this.request('/responses',{model:this.model,instructions,input,store:false,stream:true}));if(session!==this.session)fail('账号连接已改变，请重试');this.verified=true;return result;}
  async test(){const text=await this.infer('Reply with exactly OK.',[{role:'user',content:'Connection test. Reply OK.'}]);if(text.trim()!=='OK'){this.verified=false;fail('连接测试返回异常，请重试');}return this.status();}
}

