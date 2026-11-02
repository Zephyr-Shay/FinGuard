import {chromium} from 'file:///C:/Users/XieZe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {Accounts} from '../accounts.mjs';import {createTester} from '../demo-account.mjs';import {createHandler} from '../server.mjs';import {plannerError} from '../planner-errors.mjs';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import http from 'node:http';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));mkdirSync(root+'/.test-data',{recursive:true});const folder=mkdtempSync(root+'/.test-data/intent-browser-'),a=new Accounts(folder);createTester(a.db);
for(const k of ['FINGUARD_MODEL_URL','FINGUARD_MODEL_KEY','FINGUARD_MODEL'])delete process.env[k];
const planner=async message=>{if(message.includes('不完整'))throw plannerError('AI_REPLY_INCOMPLETE','fixture only');if(message.includes('给陈晨转500元'))return {mode:'model',plan:{action:'banking',steps:[['lin',50000],['chen-a',30000]].map(([recipient,cents])=>({kind:'transfer',recipient,cents,reserve:0,date:new Date(Date.now()+86400000).toISOString().slice(0,10)}))}};return {mode:'model',plan:message==='你好'?{action:'chat',answer:'你好，可以查看账单或安排转账。'}:{action:'transfer',recipient:message.includes('对象错配')?'chen-a':'lin',cents:message.includes('500')?50000:30000}};};
const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,h=createHandler({folder,port,scheduler:false,planner,configured:()=>false});server.on('request',h);
const report={version:'1.0.0',date:new Date(Date.now()+28800000).toISOString().slice(0,10),fixture:true,errors:[],checks:[]};let b;
try{
 b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>report.errors.push(e.message));const base='http://127.0.0.1:'+port;
 await p.goto(base);await p.locator('#login-user').fill('tester');await p.locator('#login-password').fill('tester');await p.locator('#login-submit').click();await p.locator('#message').waitFor();
 async function say(message){await p.locator('#message').fill(message);await p.getByRole('button',{name:'发送目标',exact:true}).click();await p.waitForResponse(r=>r.url().endsWith('/api/state')&&r.ok());await p.locator('#message:not([disabled])').waitFor();}
 async function fresh(){if(await p.locator('[data-action="new"]').count())await p.locator('[data-action="new"]').click();}
 for(const message of ['给林晓转账，金额你看着办','随便给林晓转点钱','给林晓转一些钱过去','给林晓转几百块']){
  await fresh();await say(message);assert.match(await p.locator('#home-latest-reply').innerText(),/确认.*多少元/);assert.equal(await p.locator('dialog[open]').count(),0);report.checks.push('含糊金额显示可见追问且不弹执行确认：'+message);
 }
 await p.screenshot({path:root+'/docs/V1.0-intent-clarification.png'});
 await say('300元');assert.match(await p.locator('#home-latest-reply').innerText(),/核对/);report.checks.push('在同一追问会话补充具体金额后进入待确认流程');
 if(await p.locator('dialog[open]').count())await p.locator('dialog[open] [data-dialog-close],dialog[open] [data-close],dialog[open] .dialog-close,dialog[open] button[aria-label="关闭"]').first().click().catch(async()=>p.keyboard.press('Escape'));
 await fresh();await say('你好');assert.match(await p.locator('#home-latest-reply').innerText(),/你好/);assert.equal(await p.locator('dialog[open]').count(),0);report.checks.push('日常聊天直接回答，不追问转账金额');
 await fresh();await say('触发回复不完整');await p.locator('.home-chat-error').waitFor();assert.match(await p.locator('.home-chat-error').innerText(),/回复不完整.*未执行/);report.checks.push('不完整回复的恢复提示显示在对话区域');
 await fresh();await say('给林晓转300元，给陈晨转500元');assert.match(await p.locator('#home-latest-reply').innerText(),/逐笔确认收款人与金额/);assert.equal(await p.locator('dialog[open]').count(),0);report.checks.push('多步候选金额对调时显示配对追问，不弹确认窗口');
 await p.screenshot({path:root+'/docs/V1.0-recipient-clarification.png'});
 await fresh();await say('对象错配：给林晓转300元');assert.match(await p.locator('#home-latest-reply').innerText(),/逐笔确认/);assert.equal(await p.locator('dialog[open]').count(),0);report.checks.push('单笔候选收款人错配时继续追问');
 await fresh();await say('再加200元');assert.match(await p.locator('#home-latest-reply').innerText(),/最终.*总金额/);assert.equal(await p.locator('dialog[open]').count(),0);report.checks.push('追加金额显示最终总额追问，不自动求和');
 const response=await p.request.get(base+'/api/state'),state=await response.json();assert.equal(state.balance,1856000);assert.equal(state.orders.length,0);assert.equal(state.banking?.plans?.length||0,0);report.checks.push('全部对话检查结束后余额不变、没有新增订单或错配业务计划');
 await p.setViewportSize({width:390,height:844});await p.locator('#home-latest-reply').scrollIntoViewIfNeeded();assert.ok(await p.locator('#home-latest-reply').isVisible());assert.match(await p.locator('#home-latest-reply').innerText(),/最终.*总金额/);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:root+'/docs/V1.0-recipient-mobile.png',fullPage:true});report.checks.push('手机端最终金额追问可见且没有横向溢出');
 await fresh();await say('触发回复不完整');await p.locator('.home-chat-error').scrollIntoViewIfNeeded();assert.ok(await p.locator('.home-chat-error').isVisible());await p.screenshot({path:root+'/docs/V1.0-intent-mobile.png',fullPage:true});report.checks.push('手机端失败提示可见');
 assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report));
}finally{writeFileSync(root+'/docs/V1.0-intent-browser-results.json',JSON.stringify(report,null,2));await b?.close();h.close();a.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(folder.startsWith(root+'/.test-data/'));rmSync(folder,{recursive:true,force:true});}
