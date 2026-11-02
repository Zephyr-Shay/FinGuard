const {chromium}=await import(process.env.FINGUARD_PLAYWRIGHT || 'playwright');
import http from 'node:http';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {Accounts} from '../accounts.mjs';
import {createHandler} from '../server.mjs';
import assert from 'node:assert/strict';
mkdirSync('.test-data',{recursive:true});mkdirSync('docs',{recursive:true});
const folder=mkdtempSync('.test-data/browser-');
const accounts=new Accounts(folder);await accounts.create('browser_test','Browser-Test-123!');accounts.close();
const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const handler=createHandler({port,folder,configured:()=>false});server.on('request',handler);
let browser;try{
browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}`);await page.locator('#login-user').waitFor();await page.screenshot({path:'docs/V1.7-regression-login.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/V1.7-regression-login-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});await page.locator('#login-user').fill('browser_test');await page.locator('#login-password').fill('Browser-Test-123!');await page.locator('#login-submit').click();await page.locator('[data-nav="pending"]').waitFor();await page.locator('.balance-strip').waitFor();await page.locator('#message').fill('给我爸转三千');await page.getByRole('button',{name:'发送目标'}).click();await page.getByText('请补充信息',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'批准这次操作'}).count(),0);await page.screenshot({path:'docs/V1.7-regression-home.png',fullPage:true});await page.locator('[data-nav="pending"]').click();await page.locator('.activity-row').filter({hasText:'给我爸转三千'}).waitFor();
await page.locator('nav [data-nav="bills"]').click();await page.locator('.risk-banner').waitFor();
await page.locator('#edit-needs').click();await page.locator('[data-preset="careful"]').click();await page.getByRole('button',{name:'保存偏好并重新分析'}).click();await page.locator('.answer-text').filter({hasText:'缺口'}).waitFor();assert.match(await page.locator('.answer-text').innerText(),/495.00/);
await page.locator('#analysis-question').fill('餐饮哪几笔最多？');await page.getByRole('button',{name:'发送账单问题'}).click();await page.waitForFunction(()=>document.querySelectorAll('.answer-text').length===2);assert.match(await page.locator('.answer-text').last().innerText(),/B011/);
await page.locator('#edit-needs').click();await page.locator('[data-preset="flexible"]').click();await page.getByRole('button',{name:'保存偏好并重新分析'}).click();await page.locator('.answer-text').filter({hasText:'9505.00'}).waitFor();
await page.locator('[data-open-anomaly]').first().click();await page.locator('#review-form').waitFor();await page.locator('#review-form select').selectOption('resolved');await page.getByRole('button',{name:'保存处理记录'}).click();await page.getByText('请填写核对依据或处理结果，不能直接认定已解决').waitFor();await page.locator('#review-form select').selectOption('contacted');await page.locator('#review-form textarea').fill('已联系商户，等待核对两个订单。');await page.getByRole('button',{name:'保存处理记录'}).click();await page.getByText('已保存。仅更新核对记录，账户余额未改变。').waitFor();await page.reload();await page.locator('nav [data-nav="bills"]').click();await page.locator('[data-bill-tab="review"]').click();await page.locator('.case-note').filter({hasText:'已联系商户'}).waitFor();await page.screenshot({path:'docs/V1.7-regression-review.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/V1.7-regression-review-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
const downloading=page.waitForEvent('download');await page.locator('[data-draft]').click();assert.match((await downloading).suggestedFilename(),/核对材料/);
await page.locator('nav [data-nav="bills"]').click();await page.screenshot({path:'docs/V1.7-regression-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/V1.7-regression-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#logout').click();await page.locator('#login-user').waitFor();await page.reload();await page.locator('#login-user').waitFor();assert.deepEqual(errors,[]);console.log('Browser PASS: navigation, profiles, follow-up, review, download, mobile overflow, no page errors');
}finally{await browser?.close();await new Promise(r=>server.close(r));handler.close();}



