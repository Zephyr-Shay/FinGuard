import {SecretBox,base32,matchedStep} from './totp.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
const scrypt=promisify(derive),digest=v=>createHash('sha256').update(v).digest('hex');
export class Accounts {
 constructor(folder,{now=()=>Date.now(),passwordHash=scrypt}={}){mkdirSync(folder,{recursive:true});this.now=now;this.passwordHash=passwordHash;this.loginInFlight=new Map();this.db=new DatabaseSync(join(folder,'accounts.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payment_credentials(user_id TEXT PRIMARY KEY REFERENCES users(id),salt TEXT NOT NULL,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);');this.db.exec('CREATE TABLE IF NOT EXISTS mfa(user_id TEXT PRIMARY KEY,secret TEXT NOT NULL,last INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS mfa_pending(user_id TEXT PRIMARY KEY,session TEXT NOT NULL,secret TEXT NOT NULL,expires INTEGER NOT NULL,previous TEXT);');this.box=new SecretBox(folder,Boolean(this.db.prepare('SELECT 1 FROM mfa UNION SELECT 1 FROM mfa_pending LIMIT 1').get()));}
 async create(username,password){if(!/^[a-z0-9_]{3,32}$/.test(username)||typeof password!=='string'||password.length<12||password.length>128||password.trim().toLowerCase()===username)throw Error('账号或密码格式不正确');const salt=randomBytes(16).toString('hex'),hash=Buffer.from(await scrypt(password,salt,64)).toString('hex');const id=randomUUID();this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,username,salt,hash);return {id,username};}
 async login(username,password,ip='local'){
  if(typeof username!=='string'||typeof password!=='string'||username.length>32||password.length>128)throw Error('账号或密码不正确');
  username=username.trim().toLowerCase();const now=this.now();this.db.prepare('DELETE FROM attempts WHERE expires<=?').run(now);
  const keys=['u:'+username,'ip:'+ip];for(const key of keys){const r=this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key);if(r&&r.count>=(key.startsWith('u:')?8:60)){const e=Error('尝试次数过多，请15分钟后重试');e.status=429;throw e;}}
  const active=['all',...keys],limits=[32,4,16];
  if(active.some((key,i)=>(this.loginInFlight.get(key)||0)>=limits[i])){const e=Error('登录请求较多，请稍后重试');e.status=429;throw e;}
  for(const key of active)this.loginInFlight.set(key,(this.loginInFlight.get(key)||0)+1);
  try{
   const u=this.db.prepare('SELECT * FROM users WHERE username=?').get(username);
   const hash=Buffer.from(await this.passwordHash(password,u?.salt||'finguard-dummy-salt',64));
   this.db.exec('BEGIN IMMEDIATE');
   try{
    // Password changes may finish while the KDF runs. Session issuance and
    // credential revalidation must be in the same transaction.
    const live=u&&this.db.prepare('SELECT * FROM users WHERE id=? AND username=?').get(u.id,username);
    if(!live||live.salt!==u.salt||live.hash!==u.hash||!timingSafeEqual(hash,Buffer.from(live.hash,'hex'))){
     for(const key of keys)this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,this.now()+900000);
     this.db.exec('COMMIT');throw Error('账号或密码不正确');
    }
    this.db.prepare('DELETE FROM attempts WHERE key=?').run(keys[0]);this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.now());
    const token=randomBytes(32).toString('base64url');this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),live.id,this.now()+7*86400000);
    this.db.exec('COMMIT');return {token,user:{id:live.id,username:live.username}};
   }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
  }finally{for(const key of active){const count=this.loginInFlight.get(key)-1;if(count)this.loginInFlight.set(key,count);else this.loginInFlight.delete(key);}}
 }
 async changePassword(token,currentPassword,newPassword){
  const user=this.user(token);if(!user)throw Error('账号或密码不正确');
  if(typeof currentPassword!=='string'||currentPassword.length>128||typeof newPassword!=='string'||newPassword.length<12||newPassword.length>128||newPassword.trim().toLowerCase()===user.username)throw Error('账号或密码不正确');
  const key='p:'+user.id,now=this.now();this.db.prepare('DELETE FROM attempts WHERE expires<=?').run(now);
  const attempts=this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key);if(attempts?.count>=8){const e=Error('尝试次数过多，请15分钟后重试');e.status=429;throw e;}
  this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);
  const u=this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  const old=Buffer.from(await scrypt(currentPassword,u.salt,64));if(!timingSafeEqual(old,Buffer.from(u.hash,'hex')))throw Error('账号或密码不正确');
  const salt=randomBytes(16).toString('hex'),hash=Buffer.from(await scrypt(newPassword,salt,64)).toString('hex');
  this.db.exec('BEGIN IMMEDIATE');try{
   if(!this.user(token))throw Error('账号或密码不正确');
   const changed=this.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=? AND hash=?').run(salt,hash,u.id,u.hash);if(changed.changes!==1)throw Error('账号或密码不正确');
   this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }

 mfaStatus(id){return Boolean(this.db.prepare('SELECT 1 FROM mfa WHERE user_id=?').get(id));}
 mfaAttempt(id){const key='mfa:'+id,now=this.now();this.db.prepare('DELETE FROM attempts WHERE expires<=?').run(now);if(this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key)?.count>=5){const e=Error('动态验证尝试过多，请15分钟后重试');e.status=429;throw e;}this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);return key;}
 verifyMfa(token,code){const user=this.user(token);if(!user)throw Error('请重新登录');const key=this.mfaAttempt(user.id),row=this.db.prepare('SELECT * FROM mfa WHERE user_id=?').get(user.id);if(!row)throw Error('请先到卡片与安全绑定手机验证器');const step=matchedStep(this.box.open(row.secret,user.id),code,this.now(),row.last);if(this.db.prepare('UPDATE mfa SET last=? WHERE user_id=? AND secret=? AND last=?').run(step,user.id,row.secret,row.last).changes!==1)throw Error('验证码已使用，请等待新验证码');this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);}
 async beginMfa(token,password,code){const user=this.user(token);if(!user)throw Error('请重新登录');const key=this.mfaAttempt(user.id),u=this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);if(typeof password!=='string'||password.length>128||!timingSafeEqual(Buffer.from(await scrypt(password,u.salt,64)),Buffer.from(u.hash,'hex')))throw Error('登录密码不正确');if(!this.user(token)||this.db.prepare('SELECT hash FROM users WHERE id=?').get(user.id)?.hash!==u.hash)throw Error('账号已变化，请重试');const old=this.db.prepare('SELECT secret FROM mfa WHERE user_id=?').get(user.id);if(old)this.verifyMfa(token,code);const secret=base32(randomBytes(20));this.db.prepare('INSERT INTO mfa_pending VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET session=excluded.session,secret=excluded.secret,expires=excluded.expires,previous=excluded.previous').run(user.id,digest(token),this.box.seal(secret,user.id),this.now()+300000,old?.secret||null);this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);return {secret,account:'FinGuard:'+user.username,expires:this.now()+300000};}
 confirmMfa(token,code){const user=this.user(token);if(!user)throw Error('请重新登录');const key=this.mfaAttempt(user.id),p=this.db.prepare('SELECT * FROM mfa_pending WHERE user_id=?').get(user.id),old=this.db.prepare('SELECT secret FROM mfa WHERE user_id=?').get(user.id);if(!p||p.session!==digest(token)||p.expires<=this.now()||(old?.secret||null)!==p.previous)throw Error('绑定请求已失效，请重新开始');const step=matchedStep(this.box.open(p.secret,user.id),code,this.now());this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO mfa VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,last=excluded.last').run(user.id,p.secret,step);this.db.prepare('DELETE FROM mfa_pending WHERE user_id=?').run(user.id);this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 paymentStatus(id){return Boolean(this.db.prepare('SELECT 1 FROM payment_credentials WHERE user_id=?').get(id));}
 paymentAttempt(id){const key='pay:'+id,now=this.now();this.db.prepare('DELETE FROM attempts WHERE expires<=?').run(now);if(this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key)?.count>=5){const e=Error('支付验证次数过多，请15分钟后重试');e.status=429;throw e;}this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);return key;}
 async verifyPayment(token,pin){
  const user=this.user(token);if(!user)throw Error('登录已失效，请重新登录');
  const key=this.paymentAttempt(user.id),row=this.db.prepare('SELECT * FROM payment_credentials WHERE user_id=?').get(user.id);
  if(!row)throw Error('请先到卡片与安全设置支付密码');
  if(typeof pin!=='string'||!/^\d{6}$/.test(pin))throw Error('请输入6位支付密码');
  const hash=Buffer.from(await scrypt(pin,row.salt,64));
  if(!timingSafeEqual(hash,Buffer.from(row.hash,'hex')))throw Error('支付密码不正确');
  if(!this.user(token)||this.db.prepare('SELECT hash FROM payment_credentials WHERE user_id=?').get(user.id)?.hash!==row.hash)throw Error('安全设置已变化，请重新验证');
  this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);
 }
 async setPayment(token,{loginPassword,currentPin,newPin}){
  const user=this.user(token);if(!user)throw Error('登录已失效，请重新登录');
  if(typeof newPin!=='string'||!/^\d{6}$/.test(newPin)||/^(\d)\1{5}$/.test(newPin)||['123456','654321'].includes(newPin))throw Error('支付密码须为6位数字，不能使用连续或重复数字');
  const key=this.paymentAttempt(user.id),u=this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id),old=this.db.prepare('SELECT * FROM payment_credentials WHERE user_id=?').get(user.id);
  if(typeof loginPassword!=='string'||loginPassword.length>128)throw Error('登录密码不正确');
  if(!timingSafeEqual(Buffer.from(await scrypt(loginPassword,u.salt,64)),Buffer.from(u.hash,'hex')))throw Error('登录密码不正确');
  if(old){if(typeof currentPin!=='string'||!/^\d{6}$/.test(currentPin)||!timingSafeEqual(Buffer.from(await scrypt(currentPin,old.salt,64)),Buffer.from(old.hash,'hex')))throw Error('原支付密码不正确');}
  const salt=randomBytes(16).toString('hex'),hash=Buffer.from(await scrypt(newPin,salt,64)).toString('hex');
  this.db.exec('BEGIN IMMEDIATE');try{
   const latest=this.db.prepare('SELECT hash FROM payment_credentials WHERE user_id=?').get(user.id);
   if(!this.user(token)||this.db.prepare('SELECT hash FROM users WHERE id=?').get(user.id)?.hash!==u.hash||latest?.hash!==old?.hash)throw Error('账号安全状态已变化，请重试');
   this.db.prepare('INSERT INTO payment_credentials VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,hash=excluded.hash').run(user.id,salt,hash);
   this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 recoveryAttempt(id,prefix='pay-reset:'){const key=prefix+id,now=this.now();this.db.prepare('DELETE FROM attempts WHERE expires<=?').run(now);if(this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key)?.count>=5){const e=Error('身份核验尝试过多，请15分钟后重试');e.status=429;throw e;}this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);return key;}
 async checkPaymentRecovery(token,loginPassword){
  const user=this.user(token);if(!user)throw Error('登录已失效，请重新登录');
  const old=this.db.prepare('SELECT * FROM payment_credentials WHERE user_id=?').get(user.id),mfa=this.db.prepare('SELECT secret FROM mfa WHERE user_id=?').get(user.id);
  if(!old)throw Error('尚未设置支付密码，请使用首次设置入口');
  if(!mfa)throw Error('未绑定手机验证器，不能自助重设支付密码，请联系管理员核实身份');
  const key=this.recoveryAttempt(user.id,'pay-reset-login:'),u=this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if(typeof loginPassword!=='string'||loginPassword.length>128||!timingSafeEqual(Buffer.from(await scrypt(loginPassword,u.salt,64)),Buffer.from(u.hash,'hex')))throw Error('登录密码不正确');
  if(!this.user(token)||this.db.prepare('SELECT hash FROM users WHERE id=?').get(user.id)?.hash!==u.hash||this.db.prepare('SELECT hash FROM payment_credentials WHERE user_id=?').get(user.id)?.hash!==old.hash||this.db.prepare('SELECT secret FROM mfa WHERE user_id=?').get(user.id)?.secret!==mfa.secret)throw Error('账号安全状态已变化，请重新核验');
  this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);
  return {userId:user.id,loginHash:u.hash,paymentHash:old.hash,mfaSecret:mfa.secret};
 }
 async resetPayment(token,{loginPassword,newPin,totp}){
  if(typeof newPin!=='string'||!/^\d{6}$/.test(newPin)||/^(\d)\1{5}$/.test(newPin)||['123456','654321'].includes(newPin))throw Error('支付密码须为6位数字，不能使用连续或重复数字');
  const user=this.user(token);if(!user)throw Error('登录已失效，请重新登录');this.recoveryAttempt(user.id);
  const checked=await this.checkPaymentRecovery(token,loginPassword),salt=randomBytes(16).toString('hex'),hash=Buffer.from(await scrypt(newPin,salt,64)).toString('hex');
  const mfaKey=this.mfaAttempt(checked.userId);
  this.db.exec('BEGIN IMMEDIATE');try{
   const live=this.user(token);
   if(!live||live.id!==checked.userId||this.db.prepare('SELECT hash FROM users WHERE id=?').get(live.id)?.hash!==checked.loginHash||this.db.prepare('SELECT hash FROM payment_credentials WHERE user_id=?').get(live.id)?.hash!==checked.paymentHash||this.db.prepare('SELECT secret FROM mfa WHERE user_id=?').get(live.id)?.secret!==checked.mfaSecret)throw Error('账号安全状态已变化，请重新核验');
   const factor=this.db.prepare('SELECT * FROM mfa WHERE user_id=?').get(live.id),step=matchedStep(this.box.open(factor.secret,live.id),totp,this.now(),factor.last);
   if(this.db.prepare('UPDATE mfa SET last=? WHERE user_id=? AND secret=? AND last=?').run(step,live.id,factor.secret,factor.last).changes!==1)throw Error('验证码已使用，请等待新验证码');
   this.db.prepare('UPDATE payment_credentials SET salt=?,hash=? WHERE user_id=? AND hash=?').run(salt,hash,live.id,checked.paymentHash);
   this.db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(live.id,digest(token));
   this.db.prepare('DELETE FROM mfa_pending WHERE user_id=?').run(live.id);
   this.db.prepare('DELETE FROM attempts WHERE key IN (?,?,?,?)').run('pay:'+live.id,'pay-reset:'+live.id,'pay-reset-login:'+live.id,mfaKey);
   const time=new Date(this.now()).toISOString();this.db.exec('COMMIT');return {ok:true,resetAt:time};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async prepareDemoReset(token,{loginPassword,totp}){
  const user=this.user(token);if(!user)throw Error('登录已失效，请重新登录');
  const key=this.recoveryAttempt(user.id,'demo-reset:'),u=this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id),guard=this.authorizationGuard(token);
  if(typeof loginPassword!=='string'||loginPassword.length>128||!timingSafeEqual(Buffer.from(await scrypt(loginPassword,u.salt,64)),Buffer.from(u.hash,'hex')))throw Error('登录密码不正确');
  guard();const freshToken=randomBytes(32).toString('base64url');let used=false;
  return {token:freshToken,apply:()=>{
   if(used||!this.db.isTransaction)throw Error('重置请求已失效，请重新核对');guard();
   const factor=this.db.prepare('SELECT * FROM mfa WHERE user_id=?').get(user.id);
   if(factor){this.mfaAttempt(user.id);matchedStep(this.box.open(factor.secret,user.id),totp,this.now(),factor.last);}
   this.db.prepare('DELETE FROM payment_credentials WHERE user_id=?').run(user.id);
   this.db.prepare('DELETE FROM mfa WHERE user_id=?').run(user.id);
   this.db.prepare('DELETE FROM mfa_pending WHERE user_id=?').run(user.id);
   this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
   this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(freshToken),user.id,this.now()+7*86400000);
   this.db.prepare('DELETE FROM attempts WHERE key IN (?,?,?,?,?)').run(key,'pay:'+user.id,'mfa:'+user.id,'pay-reset:'+user.id,'pay-reset-login:'+user.id);used=true;
  }};
 }
 authorizationGuard(token){const snapshot=()=>{const user=this.user(token);if(!user)return null;const u=this.db.prepare('SELECT hash FROM users WHERE id=?').get(user.id),pin=this.db.prepare('SELECT hash FROM payment_credentials WHERE user_id=?').get(user.id),mfa=this.db.prepare('SELECT secret FROM mfa WHERE user_id=?').get(user.id);return digest(JSON.stringify([user.id,u?.hash,pin?.hash,mfa?.secret]));};const before=snapshot();if(!before)throw Error('登录已失效，请重新登录');return ()=>{if(snapshot()!==before)throw Error('账号安全状态已变化，请重新验证');};}
 user(token){if(!token||!/^[\w-]{43}$/.test(token))return null;return this.db.prepare('SELECT users.id,users.username FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.hash=? AND sessions.expires>?').get(digest(token),this.now())||null;}
 logout(token){if(token)this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));}
 close(){this.db.close();}
}
export const sessionToken=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('fg_session='))?.slice(11)||'';
