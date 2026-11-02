import {createHmac,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,out='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
export function unbase32(text){let bits=0,value=0,out=[];for(const c of text){const n=alphabet.indexOf(c);if(n<0)throw Error('验证器密钥格式错误');value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
// RFC 6238 / RFC 4226 dynamic truncation. Codes never enter model context.
export function otp(secret,time=Date.now(),digits=6){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const mac=createHmac('sha1',unbase32(secret)).update(counter).digest(),o=mac[19]&15;return String((mac.readUInt32BE(o)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function matchedStep(secret,code,time,last=-1){if(typeof code!=='string'||!/^\d{6}$/.test(code))throw Error('请输入手机验证器的6位动态验证码');const n=Math.floor(time/30000);for(const step of [n,n-1,n+1]){if(step>last&&timingSafeEqual(Buffer.from(otp(secret,step*30000)),Buffer.from(code)))return step;}throw Error('动态验证码无效、已使用或已过期，请等待新验证码');}
export class SecretBox{
 constructor(folder,hasSecrets=false){const path=join(folder,'mfa.key');if(!existsSync(path)){if(hasSecrets)throw Error('验证器加密密钥缺失，请恢复备份');try{writeFileSync(path,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}this.key=readFileSync(path);if(this.key.length!==32)throw Error('验证器加密密钥无效');}
 seal(value,user){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv);c.setAAD(Buffer.from(user));const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64');}
 open(value,user){const b=Buffer.from(value,'base64'),c=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));c.setAAD(Buffer.from(user));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');}
}
