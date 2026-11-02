import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {ModelControls,modelContext,modelMessages} from '../model-controls.mjs';
import {explainMessage,structuredMessage} from '../planner.mjs';
function fixture(t,options={}){const db=new DatabaseSync(':memory:'),c=new ModelControls(db,options);t.after(()=>db.close());return c;}
function configure(t){const previous=globalThis.fetch,names=['FINGUARD_MODEL_URL','FINGUARD_MODEL_KEY','FINGUARD_MODEL'],old=names.map(n=>process.env[n]);process.env.FINGUARD_MODEL_URL='https://api.deepseek.com/chat/completions';process.env.FINGUARD_MODEL_KEY='fixture-not-a-real-api-key';process.env.FINGUARD_MODEL='fixture';t.after(()=>{globalThis.fetch=previous;names.forEach((n,i)=>old[i]===undefined?delete process.env[n]:process.env[n]=old[i]);});}
const run=(c,user,f)=>modelContext.run(c.context(user),f);

test('R07: external transport requires consent and a live authenticated model context before any network call',async t=>{
 configure(t);const c=fixture(t);let calls=0;globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'只读回答'}}],usage:{total_tokens:90}})};};
 await assert.rejects(explainMessage('说明',[]),e=>e.code==='AI_CONTEXT_REQUIRED');
 await assert.rejects(run(c,'alice',()=>explainMessage('说明',[])),e=>e.code==='AI_CONSENT_REQUIRED');assert.equal(calls,0);
 c.consent('alice',true);assert.equal(await run(c,'alice',()=>explainMessage('说明',[])),'只读回答');assert.equal(calls,1);assert.equal(c.status('alice').used.tokens,90);
 c.consent('alice',false);await assert.rejects(run(c,'alice',()=>explainMessage('说明',[])),e=>e.code==='AI_CONSENT_REQUIRED');assert.equal(calls,1);
});

test('R04: retries reserve independently, and exhausted global request quota blocks the next HTTP attempt',async t=>{
 configure(t);const c=fixture(t,{limits:{globalRequests:1}});c.consent('alice',true);let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:''}}]})};};
 await assert.rejects(run(c,'alice',()=>structuredMessage('JSON',[])),e=>e.code==='AI_BUDGET_EXCEEDED');assert.equal(calls,1);assert.equal(c.status('alice').used.requests,1);
 assert.ok(c.status('alice').used.tokens>=1800);assert.equal(c.db.prepare('SELECT requests FROM ai_usage WHERE owner=?').get('*').requests,1);
});

test('R04: failed transport retains its token reservation; unknown or duplicate settlements cannot refund quota',async t=>{
 configure(t);const c=fixture(t);c.consent('alice',true);globalThis.fetch=async()=>{throw Error('fixture transport failure');};
 await assert.rejects(run(c,'alice',()=>explainMessage('说明',[])),e=>e.code==='AI_SERVICE_UNAVAILABLE'&&e.cause?.message==='fixture transport failure');const before=c.status('alice').used.tokens;assert.ok(before>1800);
 const row=c.db.prepare('SELECT id FROM ai_calls').get();c.settle(row.id,undefined);assert.equal(c.status('alice').used.tokens,before);c.settle(row.id,100);c.settle(row.id,1);assert.equal(c.status('alice').used.tokens,100);
});

test('R04: daily quotas survive restart, use Beijing midnight, and global limit includes different accounts',t=>{
 const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'quota-'));let db=new DatabaseSync(join(folder,'quota.sqlite')),now=Date.parse('2026-11-01T15:59:59Z');
 const options={now:()=>now,limits:{userRequests:1,globalRequests:2}},create=()=>new ModelControls(db,options);let c=create();c.consent('alice',true);c.consent('bobby',true);
 run(c,'alice',()=>c.reserve('alice',[],1));run(c,'bobby',()=>c.reserve('bobby',[],1));db.close();db=new DatabaseSync(join(folder,'quota.sqlite'));c=create();
 try{assert.equal(c.status('alice').day,'2026-11-01');assert.throws(()=>run(c,'alice',()=>c.reserve('alice',[],1)),e=>e.code==='AI_BUDGET_EXCEEDED');c.consent('carol',true);assert.throws(()=>run(c,'carol',()=>c.reserve('carol',[],1)),e=>e.code==='AI_BUDGET_EXCEEDED');now+=1000;assert.equal(c.status('alice').day,'2026-11-02');assert.ok(run(c,'alice',()=>c.reserve('alice',[],1)));}finally{db.close();assert.ok(folder.startsWith(base));rmSync(folder,{recursive:true,force:true});}
});

test('R04: user and global token reservations roll back together when either quota is exceeded',t=>{
 const c=fixture(t,{limits:{globalTokens:10,userTokens:10000}});c.consent('alice',true);assert.throws(()=>run(c,'alice',()=>c.reserve('alice',[],20)),e=>e.code==='AI_BUDGET_EXCEEDED');assert.equal(c.status('alice').used.requests,0);assert.equal(c.db.prepare('SELECT count(*) AS n FROM ai_calls').get().n,0);
});

test('R07: withdrawal while an external response is pending discards the response instead of applying it',async t=>{
 configure(t);const c=fixture(t);c.consent('alice',true);let release,ready;const arrived=new Promise(r=>ready=r),wait=new Promise(r=>release=r);
 globalThis.fetch=async()=>{ready();await wait;return {ok:true,json:async()=>({choices:[{message:{content:'不应被采纳'}}]})};};
 const pending=assert.rejects(run(c,'alice',()=>explainMessage('说明',[])),e=>e.code==='AI_CONSENT_REQUIRED');await arrived;c.consent('alice',false);release();await pending;
});

test('R07: outgoing context filters credential fields and common identifiers while retaining relevant financial amounts',()=>{
 const input='登录密码是FixturePass!123 验证码:592748 手机13800138000 邮箱person@example.invalid 身份证110101199001011234 银行卡6222021234567890123 '+JSON.stringify({paymentPin:'735194',token:'opaque-authorization-secret',cardNumber:'6222021234567890123'})+' 给林晓转200元';
 const safe=modelMessages([{role:'system',content:input},{role:'user',content:input}]);const text=JSON.stringify(safe);for(const secret of ['FixturePass!123','592748','13800138000','person@example.invalid','110101199001011234','6222021234567890123','735194','opaque-authorization-secret'])assert.ok(!text.includes(secret),secret);assert.match(text,/给林晓转200元/);
});

test('结构化调用仅在已知DeepSeek非思考接口使用低温度，解释调用保持默认',async t=>{
 configure(t);const c=fixture(t);c.consent('alice',true);const bodies=[];
 globalThis.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:'{}'}}],usage:{total_tokens:20}})};};
 await run(c,'alice',()=>structuredMessage('JSON',[]));await run(c,'alice',()=>explainMessage('说明',[]));
 assert.equal(bodies[0].temperature,0);assert.equal(bodies[0].thinking.type,'disabled');assert.equal(bodies[1].temperature,undefined);
 process.env.FINGUARD_MODEL_URL='https://provider.example.invalid/chat/completions';await run(c,'alice',()=>structuredMessage('JSON',[]));assert.equal(bodies[2].temperature,undefined);
});
test('截断回复、上游异常与超时返回稳定错误码，JSON重试仍保持结构化参数',async t=>{
 configure(t);const c=fixture(t);c.consent('alice',true);let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(JSON.parse(options.body).temperature,0);return {ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{'}}]})};};
 await assert.rejects(run(c,'alice',()=>structuredMessage('JSON',[])),e=>e.code==='AI_REPLY_INCOMPLETE');assert.equal(calls,2);
 globalThis.fetch=async()=>({ok:false,status:401});await assert.rejects(run(c,'alice',()=>structuredMessage('JSON',[])),e=>e.code==='AI_SERVICE_UNAVAILABLE'&&e.message.includes('401'));
 globalThis.fetch=async()=>{const e=Error('fixture');e.name='TimeoutError';throw e;};await assert.rejects(run(c,'alice',()=>explainMessage('说明',[])),e=>e.code==='AI_SERVICE_TIMEOUT');
});
