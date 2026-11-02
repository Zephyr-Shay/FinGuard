import {chromium} from 'file:///C:/Users/XieZe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {pathToFileURL} from 'node:url';import http from 'node:http';import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
const root=(await import('node:url')).fileURLToPath(new URL('../',import.meta.url)).replace(/[/\\]$/,'');
const {Accounts}=await import(pathToFileURL(root+'/accounts.mjs')),{createHandler}=await import(pathToFileURL(root+'/server.mjs'));
mkdirSync(root+'/.test-data',{recursive:true});const folder=mkdtempSync(root+'/.test-data/v121-ui-');const a=new Accounts(folder);await a.create('budget_ui','Budget-Test-123!');a.close();
const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;server.on('request',createHandler({folder,port,scheduler:false,configured:()=>false}));let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);const base='http://127.0.0.1:'+port;
 await page.route(/\/api\/market(?:\?|$)/,r=>r.fulfill({json:{quotes:[],stale:true,notice:'隔离界面测试'}}));
 const state=()=>page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 const req=(path,body)=>page.evaluate(async({path,body})=>{const s=await fetch('/api/state').then(r=>r.json()),r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-FinGuard-User':s.user.id},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{path,body});
 const get=(host,n)=>host.locator(`[name="${n}"]`);
 await page.goto(base);await page.locator('#login-user').fill('budget_ui');await page.locator('#login-password').fill('Budget-Test-123!');await page.locator('#login-submit').click();await page.locator('.home-columns').waitFor();const before=await state(),month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 await req('/api/personal/budget',{month,budget:901800,reserve:100000,categoryBudgets:{生活:266700}});
 await page.reload();await page.locator('.home-account [data-budget-settings]').click();let form=page.locator('#budget-settings-form');await form.waitFor();
 assert.equal(await get(form,'totalBudget').inputValue(),'10018');assert.equal(await get(form,'cat-生活').inputValue(),'2667');assert.equal(await form.locator('[data-budget-save]').isDisabled(),true);
 await get(form,'totalBudget').fill('10000');await get(form,'reserve').fill('2000');
 const caps={居住:3000,餐饮:1500,生活:1000,学习:500,订阅:200,交通:300,其他:1500};
 for(const [c,n]of Object.entries(caps))await get(form,'cat-'+c).fill(String(n));
 assert.match(await form.locator('[data-spendable]').innerText(),/8,000.00/);assert.equal(await form.getAttribute('data-allocation-state'),'balanced');
 await get(form,'cat-其他').fill('1600');assert.match(await form.locator('[data-allocation-status]').innerText(),/超配.*100.00/);assert.equal(await form.locator('[data-budget-save]').isDisabled(),true);
 const invalid=await req('/api/personal/budget',{month,totalBudget:1000000,reserve:200000,categoryBudgets:{其他:810000}});assert.equal(invalid.status,400);assert.equal((await state()).personal.plan.budget,901800);
 await get(form,'cat-其他').fill('1400');assert.match(await form.locator('[data-allocation-status]').innerText(),/还可分配.*100.00/);await form.locator('[data-allocate-remainder]').click();assert.equal(await get(form,'cat-其他').inputValue(),'1500');
 await get(form,'reserve').fill('10001');assert.match(await form.locator('[data-allocation-status]').innerText(),/不能超过/);assert.equal(await form.locator('[data-budget-save]').isDisabled(),true);await get(form,'reserve').fill('2000');
 await page.screenshot({path:root+'/docs/V1.21-budget-desktop.png',fullPage:true});
 await form.locator('[data-budget-save]').click();await page.locator('#budget-settings-dialog').waitFor({state:'detached'});
 let s=await state();assert.equal(s.personal.plan.totalBudget,1000000);assert.equal(s.personal.plan.budget,800000);assert.equal(s.balance,before.balance);assert.equal(s.orders.length,before.orders.length);assert.equal(Object.values(s.personal.plan.categoryBudgets).reduce((a,b)=>a+b,0),800000);assert.match(await page.locator('.home-account .budget-total-equation').innerText(),/10,000.00.*2,000.00.*8,000.00/);
 // The former full-page slider editor now uses the same validated editor.
 await page.goto(base+'/?view=profile');await page.locator('[data-plan-section="budget-form"]').click();form=page.locator('#budget-form');await form.waitFor();assert.equal(await form.locator('input[type=range]').count(),0);assert.equal(await get(form,'totalBudget').inputValue(),'10000');
 await get(form,'totalBudget').fill('10000.01');await form.locator('[data-allocate-spending]').click();assert.equal(await form.getAttribute('data-allocation-state'),'balanced');
 const sum=await form.locator('[name^="cat-"]').evaluateAll(els=>els.reduce((n,e)=>n+Math.round(Number(e.value)*100),0));assert.equal(sum,800001);
 await form.locator('[data-budget-save]').click();await page.waitForFunction(()=>document.querySelector('#budget-form [name=totalBudget]')?.value==='10000.01'&&document.querySelector('#budget-form [data-budget-save]')?.disabled===false);
 await page.screenshot({path:root+'/docs/V1.21-budget-planning.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.goto(base);await page.locator('.home-account [data-budget-settings]').click();form=page.locator('#budget-settings-form');await form.waitFor();
 const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,view:innerWidth,dialog:document.querySelector('#budget-settings-dialog').getBoundingClientRect().width,content:document.querySelector('#budget-settings-dialog').scrollWidth}));assert.ok(width.body<=width.view);assert.ok(width.content<=width.dialog+1);
 await page.screenshot({path:root+'/docs/V1.21-budget-mobile.png',fullPage:true});
 // Cancel preserves the exact saved configuration, including cents.
 const saved=structuredClone((await state()).personal.plan);await get(form,'reserve').fill('500');await form.locator('[data-budget-cancel]').click();assert.deepEqual((await state()).personal.plan,saved);
 // No records means equal shares, with every leftover cent still allocated.
 await page.goto(base+'/?view=profile');await page.locator('[data-plan-section="budget-form"]').click();form=page.locator('#budget-form');await get(form,'month').fill('2027-12');await get(form,'totalBudget').fill('0.01');await get(form,'reserve').fill('0');await form.locator('[data-allocate-spending]').click();assert.equal(await form.locator('[name^="cat-"]').evaluateAll(els=>els.reduce((n,e)=>n+Math.round(Number(e.value)*100),0)),1);assert.equal(await form.getAttribute('data-allocation-state'),'balanced');
 assert.deepEqual(errors,[]);writeFileSync(root+'/docs/V1.21-browser-results.json',JSON.stringify({checkedAt:new Date().toISOString(),balancedSaved:true,serverRejectsFalseSum:true,legacyValuesKept:true,zeroAndCents:true,profileAndDialogShareEditor:true,cancelPreservesState:true,fundsUnchanged:true,desktop:true,mobile:width,errors},null,2));console.log('V1.21 browser: shared editor, exact sum, server validation, proportional cents, save/reload/cancel, desktop/mobile passed');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
