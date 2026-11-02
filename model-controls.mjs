import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';

export const modelContext=new AsyncLocalStorage();
export const AI_NOTICE_VERSION='2026-11-01-v1';
const integer=(value,fallback)=>{const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<1||n>100000000)throw Error('AI预算配置无效');return n;};
const failure=(message,code,status=409)=>Object.assign(Error(message),{code,status});

// Strip credential-shaped fields and common identifiers from every outgoing
// message, including history and JSON embedded in system context. This is a
// defence in depth filter, not a claim to recognize arbitrary personal data.
export function minimizeModelText(value){
 return String(value)
 .replace(/("(?:password|loginPassword|currentPassword|newPassword|paymentPin|currentPin|newPin|totp|secret|token|sessionToken|apiKey|accountNumber|cardNumber|phone|email|idCard)"\s*:\s*)("(?:\\.|[^"\\])*"|\d+)/gi,'$1"[敏感信息已隐藏]"')
 .replace(/((?:支付密码|登录密码|密码|验证码|动态码|password|PIN|TOTP|api[\s_-]?key)\s*(?:是|为|[:：=])\s*)[^\s，。；;！!?？<>"']{4,128}/gi,'$1[敏感信息已隐藏]')
 .replace(/\b(?:sk|Bearer)[-_ ][a-z0-9_\-]{12,}\b/gi,'[密钥已隐藏]')
 .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,'[邮箱已隐藏]')
 .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g,'[证件号码已隐藏]')
 .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[手机号已隐藏]')
 .replace(/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g,'[长号码已隐藏]');
}
export function modelMessages(messages){
 if(!Array.isArray(messages)||messages.length>40)throw Error('模型上下文过长');
 const safe=messages.map(m=>{if(!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')throw Error('模型上下文格式不正确');return {role:m.role,content:minimizeModelText(m.content)};});
 if(Buffer.byteLength(JSON.stringify(safe),'utf8')>100000)throw Error('模型上下文过长，请开始新的对话');return safe;
}
export function currentModelContext(){const context=modelContext.getStore();if(!context)throw failure('外部模型调用缺少账号与预算上下文，已停止调用','AI_CONTEXT_REQUIRED');return context;}

export class ModelControls{
 constructor(db,{now=()=>Date.now(),limits={}}={}){
  this.db=db;this.now=now;this.limits={userRequests:integer(limits.userRequests??process.env.FINGUARD_AI_USER_REQUESTS,100),userTokens:integer(limits.userTokens??process.env.FINGUARD_AI_USER_TOKENS,300000),globalRequests:integer(limits.globalRequests??process.env.FINGUARD_AI_GLOBAL_REQUESTS,500),globalTokens:integer(limits.globalTokens??process.env.FINGUARD_AI_GLOBAL_TOKENS,1500000)};
  db.exec('CREATE TABLE IF NOT EXISTS ai_consent(user_id TEXT PRIMARY KEY,version TEXT NOT NULL,enabled INTEGER NOT NULL,epoch INTEGER NOT NULL,at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ai_usage(day TEXT NOT NULL,owner TEXT NOT NULL,requests INTEGER NOT NULL,tokens INTEGER NOT NULL,PRIMARY KEY(day,owner)); CREATE TABLE IF NOT EXISTS ai_calls(id TEXT PRIMARY KEY,day TEXT NOT NULL,user_id TEXT NOT NULL,reserved INTEGER NOT NULL,settled INTEGER NOT NULL DEFAULT 0);');
 }
 consent(user,enabled){if(typeof enabled!=='boolean')throw Error('请选择是否启用外部AI');this.db.prepare('INSERT INTO ai_consent VALUES(?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled,epoch=epoch+1,at=excluded.at').run(user,AI_NOTICE_VERSION,Number(enabled),new Date(this.now()).toISOString());return this.status(user);}
 status(user){const consent=this.db.prepare('SELECT version,enabled,epoch,at FROM ai_consent WHERE user_id=?').get(user),day=this.day(),row=this.db.prepare('SELECT requests,tokens FROM ai_usage WHERE day=? AND owner=?').get(day,user);let host='未配置',privacyUrl=null;try{const u=new URL(process.env.FINGUARD_MODEL_URL);host=u.hostname;if(host==='api.deepseek.com')privacyUrl='https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html';}catch{}
  return {available:Boolean(process.env.FINGUARD_MODEL_URL&&process.env.FINGUARD_MODEL_KEY&&process.env.FINGUARD_MODEL),noticeVersion:AI_NOTICE_VERSION,consented:Boolean(consent?.enabled&&consent.version===AI_NOTICE_VERSION),epoch:consent?.epoch||0,provider:host,privacyUrl,day,used:{requests:row?.requests||0,tokens:row?.tokens||0},limits:{requests:this.limits.userRequests,tokens:this.limits.userTokens}};
 }
 day(){return new Date(this.now()+8*3600000).toISOString().slice(0,10);}
 context(user,validate=()=>{}){
  const epoch=this.status(user).epoch;
  return {controls:this,user,assertActive:()=>{validate();const live=this.status(user);if(!live.consented||live.epoch!==epoch)throw failure('使用外部AI前，请先阅读并确认数据使用说明','AI_CONSENT_REQUIRED');}};
 }
 reserve(user,messages,maxTokens){
  const context=currentModelContext();if(context.controls!==this||context.user!==user)throw Error('模型预算账号不一致');context.assertActive();
  // UTF-8 bytes deliberately overestimate input tokens. Reserve the complete
  // input plus maximum output BEFORE every paid attempt, including retries.
  const estimate=Buffer.byteLength(JSON.stringify(messages),'utf8')+integer(maxTokens,1800),day=this.day(),id=randomUUID();
  this.db.exec('BEGIN IMMEDIATE');try{context.assertActive();
   for(const [owner,requests,tokens] of [[user,this.limits.userRequests,this.limits.userTokens],['*',this.limits.globalRequests,this.limits.globalTokens]]){
    const used=this.db.prepare('SELECT requests,tokens FROM ai_usage WHERE day=? AND owner=?').get(day,owner);
    if((used?.requests||0)+1>requests||(used?.tokens||0)+estimate>tokens)throw failure('今日AI调用额度已用完，可继续手动办理业务，明日再试','AI_BUDGET_EXCEEDED',429);
    this.db.prepare('INSERT INTO ai_usage VALUES(?,?,1,?) ON CONFLICT(day,owner) DO UPDATE SET requests=requests+1,tokens=tokens+excluded.tokens').run(day,owner,estimate);
   }
   this.db.prepare('INSERT INTO ai_calls(id,day,user_id,reserved) VALUES(?,?,?,?)').run(id,day,user,estimate);this.db.exec('COMMIT');return id;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 settle(id,actual){
  // Unknown usage, transport failures and crashes retain the reservation.
  if(!Number.isSafeInteger(actual)||actual<1)return;
  this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT * FROM ai_calls WHERE id=?').get(id);if(row&&!row.settled){const delta=actual-row.reserved;for(const owner of [row.user_id,'*'])this.db.prepare('UPDATE ai_usage SET tokens=tokens+? WHERE day=? AND owner=?').run(delta,row.day,owner);this.db.prepare('UPDATE ai_calls SET settled=1 WHERE id=?').run(id);}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
