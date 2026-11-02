import {randomBytes,randomUUID,createHash,scrypt as derive} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive),digest=value=>createHash('sha256').update(value).digest('hex');
const failure=(message,status=429)=>Object.assign(Error(message),{status});

// Explicitly enabled, bounded onboarding for independent simulated accounts.
// This never resets an existing identity, payment credential or authenticator.
export class ReviewSpaces{
 constructor(accounts,{enabled=false,now=()=>Date.now(),sourceDaily=20,globalDaily=80,total=500,maxConcurrent=2,passwordHash=scrypt}={}){
  this.accounts=accounts;this.db=accounts.db;this.enabled=enabled;this.now=now;this.limits={sourceDaily,globalDaily,total,maxConcurrent};this.passwordHash=passwordHash;this.inFlight=new Map();
  this.db.exec('CREATE TABLE IF NOT EXISTS review_spaces(user_id TEXT PRIMARY KEY REFERENCES users(id),created_at INTEGER NOT NULL);');
 }
 decorate(user){return user&&this.db.prepare('SELECT 1 FROM review_spaces WHERE user_id=?').get(user.id)?{...user,reviewSpace:true}:user;}
 reserve(source){
  const now=this.now(),day=Math.floor((now+28800000)/86400000),expires=(day+1)*86400000-28800000;
  const quotas=[['demo:global:'+day,this.limits.globalDaily],['demo:source:'+day+':'+digest(source),this.limits.sourceDaily]];
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('DELETE FROM attempts WHERE expires<=?').run(now);
   if(this.db.prepare('SELECT count(*) AS n FROM review_spaces').get().n>=this.limits.total)throw failure('独立体验账户暂时已满，请使用已有账户登录');
   if(quotas.some(([key,limit])=>(this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key)?.count||0)>=limit))throw failure('今日创建次数已达上限，请使用已有账户登录');
   for(const [key]of quotas)this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,expires);
   this.db.exec('COMMIT');
  }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
 async create(username,password,source='local'){
  if(!this.enabled)throw failure('当前未开放独立体验账户',404);
  if(typeof username!=='string'||!/^demo_[a-f0-9]{24}$/.test(username)||typeof password!=='string'||!/^[A-Za-z0-9_-]{40,128}$/.test(password))throw failure('体验登录资料格式不正确，请重新打开创建窗口',400);
  const key=digest(username+'\0'+password);
  if(this.inFlight.has(key))return this.inFlight.get(key);
  if(this.inFlight.size>=this.limits.maxConcurrent)throw failure('正在创建体验账户，请稍后再试');
  const task=this.perform(username,password,String(source)).finally(()=>this.inFlight.delete(key));
  this.inFlight.set(key,task);return task;
 }
 async perform(username,password,source){
  const existing=this.db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if(existing){
   if(!this.db.prepare('SELECT 1 FROM review_spaces WHERE user_id=?').get(existing.id))throw failure('登录资料已被占用，请重新创建体验账户',409);
   const result=await this.accounts.login(username,password,source);return {...result,user:this.decorate(result.user),created:false};
  }
  this.reserve(source);
  const salt=randomBytes(16).toString('hex'),hash=Buffer.from(await this.passwordHash(password,salt,64)).toString('hex');
  // A different-password request may have raced this derivation. Never attach
  // that request to the winner's session or overwrite the winner's credentials.
  const winner=this.db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if(winner){
   if(!this.db.prepare('SELECT 1 FROM review_spaces WHERE user_id=?').get(winner.id))throw failure('登录资料已被占用，请重新创建体验账户',409);
   const result=await this.accounts.login(username,password,source);return {...result,user:this.decorate(result.user),created:false};
  }
  const user={id:randomUUID(),username,reviewSpace:true},token=randomBytes(32).toString('base64url');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(this.db.prepare('SELECT count(*) AS n FROM review_spaces').get().n>=this.limits.total)throw failure('独立体验账户暂时已满，请使用已有账户登录');
   this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id,username,salt,hash);
   this.db.prepare('INSERT INTO review_spaces VALUES(?,?)').run(user.id,this.now());
   this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,this.now()+7*86400000);
   this.db.exec('COMMIT');return {user,token,created:true};
  }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
}
