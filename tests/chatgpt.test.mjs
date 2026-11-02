import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {validateIdentity,readResponse,ChatGPTConnection} from '../chatgpt.mjs';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {Engine} from '../core.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256'};
const claims={iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'user',nonce:'nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300};
function token(overrides={}){const data=[{alg:'RS256',kid:'test'},{...claims,...overrides}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');}
test('GPT 身份签名、issuer、audience、nonce、过期与篡改验证',()=>{
 assert.equal(validateIdentity(token(),[key],'oaiapp_test','nonce').sub,'user');
 for(const change of [{iss:'https://evil.example'},{aud:'other'},{nonce:'wrong'},{exp:1},{sub:''}])assert.throws(()=>validateIdentity(token(change),[key],'oaiapp_test','nonce'));
 const parts=token().split('.');parts[1]=Buffer.from(JSON.stringify({...claims,sub:'attacker'})).toString('base64url');assert.throws(()=>validateIdentity(parts.join('.'),[key],'oaiapp_test','nonce'));
});
const event=v=>'data: '+JSON.stringify(v)+'\n\n';
test('GPT 只接受 completed，拒绝中断和流内额度错误',async()=>{
 const delta=event({type:'response.output_text.delta',delta:'OK'});
 assert.equal(await readResponse(new Response(delta+event({type:'response.completed',response:{status:'completed'}}))),'OK');
 await assert.rejects(()=>readResponse(new Response(delta)));
 await assert.rejects(()=>readResponse(new Response(delta+event({type:'response.failed'}))));
 await assert.rejects(()=>readResponse(new Response(delta+event({type:'response.incomplete'}))));
});
test('GPT 跨数据块 UTF8 与 SSE 解析',async()=>{
 const bytes=new TextEncoder().encode(event({type:'response.output_text.delta',delta:'爸爸'})+event({type:'response.completed',response:{status:'completed'}}));
 const stream=new ReadableStream({start(controller){for(const b of bytes)controller.enqueue(new Uint8Array([b]));controller.close();}});
 assert.equal(await readResponse(new Response(stream)),'爸爸');
});
test('追问信息不产生授权、订单或资金变化',()=>{
 const engine=new Engine();const before=engine.state.balance;
 const t=engine.plan('我要转钱给我爸',{action:'collect',question:'想转多少钱？爸爸对应哪位已登记联系人？'},'model');
 assert.equal(t.status,'collecting');assert.equal(t.token,undefined);assert.equal(engine.state.balance,before);assert.equal(engine.state.orders.length,0);assert.throws(()=>engine.approve(t.id,'anything'));
});
test('完整模拟 OAuth、模型列表和调用；状态不暴露 token',async t=>{
 const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'oauth-'));t.after(()=>{assert.ok(folder.startsWith(base+sep));rmSync(folder,{recursive:true,force:true});});
 let nonce;const connection=new ChatGPTConnection(folder,4317,async(url,options)=>{
   if(url.endsWith('/oauth/token')){assert.equal(options.body.get('client_id'),'oaiapp_test');assert.equal(options.body.get('redirect_uri'),'http://127.0.0.1:4317/auth/callback');return Response.json({access_token:'secret-test',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct',id_token:token({nonce})});}
   if(url.endsWith('/jwks.json'))return Response.json({keys:[key]});
   assert.equal(options.headers.Authorization,'Bearer secret-test');
   if(url.endsWith('/models'))return Response.json({models:[{slug:'gpt-test',display_name:'Test GPT',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});
   const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.model,'gpt-test');return new Response(event({type:'response.output_text.delta',delta:'OK'})+event({type:'response.completed',response:{status:'completed'}}));
 });
 const url=new URL(connection.start().url);nonce=url.searchParams.get('nonce');assert.equal(url.origin,'https://auth.openai.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 await assert.rejects(()=>connection.callback(new URLSearchParams({state:'forged'})));assert.equal(connection.status().connected,false);
 await connection.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'test',client_id:'oaiapp_test'}));
 assert.equal(connection.status().verified,false);await connection.catalog();assert.equal(connection.status().models.length,1);await connection.test();assert.equal(connection.status().verified,true);
 assert.ok(!JSON.stringify(connection.status()).includes('secret-test'));assert.ok(!readFileSync(join(folder,'chatgpt-host.json'),'utf8').includes('secret-test'));connection.disconnect();assert.equal(connection.status().connected,false);await assert.rejects(()=>connection.test());
});

function loginSetup(t,fetcher){const base=resolve('.test-data');mkdirSync(base,{recursive:true});const folder=mkdtempSync(join(base,'login-fix-'));t.after(()=>{assert.ok(folder.startsWith(base+sep));rmSync(folder,{recursive:true,force:true});});return new ChatGPTConnection(folder,4317,fetcher);}
const callbackParams=u=>new URLSearchParams({state:u.searchParams.get('state'),code:'test',client_id:'oaiapp_test'});
test('登录修复：第二次登录不覆盖第一条请求，旧回调不可重放',async t=>{let nonce;const c=loginSetup(t,async url=>url.endsWith('/jwks.json')?Response.json({keys:[key]}):Response.json({access_token:'secret',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct',id_token:token({nonce})}));const first=new URL(c.start().url);nonce=first.searchParams.get('nonce');c.start();await c.callback(callbackParams(first));assert.equal(c.status().connected,true);await assert.rejects(()=>c.callback(callbackParams(first)),{code:'LOGIN_STATE'});});
test('登录修复：过期与取消授权分别报告，不发起交换',async t=>{const c=loginSetup(t,async()=>assert.fail('must not fetch'));const u=new URL(c.start().url);c.pending.get(u.searchParams.get('state')).expires=1;await assert.rejects(()=>c.callback(callbackParams(u)),{code:'LOGIN_EXPIRED'});const v=new URL(c.start().url),p=callbackParams(v);p.set('error','access_denied');await assert.rejects(()=>c.callback(p),{code:'LOGIN_DENIED'});});
test('登录修复：网络错误不暴露原始URL和凭据',async t=>{const c=loginSetup(t,async()=>{throw Error('SECRET_URL');});await assert.rejects(()=>c.callback(callbackParams(new URL(c.start().url))),e=>e.code==='TOKEN_NETWORK'&&!e.message.includes('SECRET'));});
test('登录修复：HTML中间页不再成为模糊JSON错误',async t=>{const c=loginSetup(t,async()=>new Response('<!DOCTYPE html>SECRET',{status:502}));await assert.rejects(()=>c.callback(callbackParams(new URL(c.start().url))),e=>e.code==='TOKEN_FORMAT'&&!e.message.includes('SECRET'));});
test('登录修复：失效授权码提供重新登录提示',async t=>{const c=loginSetup(t,async()=>Response.json({error:'invalid_grant',error_description:'SECRET'},{status:400}));await assert.rejects(()=>c.callback(callbackParams(new URL(c.start().url))),e=>e.code==='LOGIN_INVALID_GRANT'&&!e.message.includes('SECRET'));});
test('登录修复：交换期间断开连接，回调不能恢复会话',async t=>{let nonce,release,entered;const ready=new Promise(r=>entered=r);const c=loginSetup(t,async url=>{if(url.endsWith('/jwks.json'))return Response.json({keys:[key]});entered();await new Promise(r=>release=r);return Response.json({access_token:'secret',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct',id_token:token({nonce})});});const u=new URL(c.start().url);nonce=u.searchParams.get('nonce');const pending=c.callback(callbackParams(u));await ready;c.disconnect();release();await assert.rejects(()=>pending,{code:'LOGIN_CANCELLED'});assert.equal(c.status().connected,false);});
