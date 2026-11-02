import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {scryptSync,randomBytes} from 'node:crypto';
import {Accounts} from '../accounts.mjs';
import {clientAddress} from '../request-source.mjs';
function setup(t){const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'close-'));const a=new Accounts(folder);t.after(()=>{a.close();assert.ok(folder.startsWith(base));rmSync(folder,{recursive:true,force:true});});return a;}

test('R01: in-flight old-password login cannot create a valid session after credential replacement',async t=>{
 const a=setup(t),u=await a.create('alice','Alice-password-123'),old=await a.login('alice','Alice-password-123');
 // Native async scrypt yields. Commit a credential reset while it is in flight,
 // without a timing-dependent sleep or a production authentication test hook.
 const pending=assert.rejects(a.login('alice','Alice-password-123'),/账号或密码不正确/);
 const salt=randomBytes(16).toString('hex'),hash=scryptSync('Changed-password-456',salt,64).toString('hex');
 a.db.exec('BEGIN IMMEDIATE');a.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,u.id);a.db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);a.db.exec('COMMIT');
 await pending;assert.equal(a.user(old.token),null);assert.equal(a.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(u.id).n,0);
 assert.equal((await a.login('alice','Changed-password-456')).user.id,u.id);
});

test('R03: successful shared-IP logins do not consume failure quota; changing IP cannot evade account throttling',async t=>{
 const a=setup(t);await a.create('alice','Alice-password-123');
 for(let i=0;i<65;i++)assert.ok((await a.login('alice','Alice-password-123','192.0.2.1')).token);
 for(let i=0;i<8;i++)await assert.rejects(a.login('alice','wrong','192.0.2.1'),/不正确/);
 await assert.rejects(a.login('alice','wrong','192.0.2.2'),e=>e.status===429);
});

test('R03: forwarded-IP spoofing ignored unless the immediate proxy is trusted; malformed headers fail closed',()=>{
 const req={socket:{remoteAddress:'::ffff:127.0.0.1'},headers:{'x-finguard-client-ip':'192.0.2.10','x-forwarded-for':'198.51.100.8'}};
 assert.equal(clientAddress(req,[]),'127.0.0.1');assert.equal(clientAddress(req,['127.0.0.1']),'192.0.2.10');
 for(const value of ['192.0.2.10, 192.0.2.11','not-an-ip',['192.0.2.10'],'127.0.0.1\r\nx: a'])assert.equal(clientAddress({...req,headers:{...req.headers,'x-finguard-client-ip':value}},['127.0.0.1']),'127.0.0.1');
 assert.equal(clientAddress({...req,socket:{remoteAddress:'192.0.2.99'}},['127.0.0.1']),'192.0.2.99');
});

test('R02: normal account APIs reject a long username used as its own password',async t=>{
 const a=setup(t);await assert.rejects(a.create('long_username','long_username'),/格式/);
 await a.create('long_username','Separate-password-123');const login=await a.login('long_username','Separate-password-123');
 await assert.rejects(a.changePassword(login.token,'Separate-password-123','long_username'),/不正确/);
});
