import {requestJSON} from '../public/request.js';
import {cashflowEntryHTML} from '../public/cashflow.js';
import {fundingEntryHTML} from '../public/funding.js';
import {budgetOverviewHTML,moneyReviewHTML,useFields} from '../public/budget.js';
import {navigationHTML,pendingCount} from '../public/navigation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Engine} from '../core.mjs';

test('登录后的页面显示退出入口而不显示个人GPT连接',async()=>{
  const nodes=new Map();
  const node=id=>{if(id==='#budget-form')return null;if(!nodes.has(id))nodes.set(id,{innerHTML:'',classList:{add(){},remove(){}},addEventListener(){},focus(){}});return nodes.get(id);};
  const requests=[];let destination;
  const state={...new Engine().snapshot(),personal:{profile:{},plan:{},goals:[],expenses:[]},planner:'local',version:'0.2.0',chatgpt:{connected:false}};
  const context=vm.createContext({requestJSON:(path,data,options)=>requestJSON(path,data,{...options,fetcher:context.fetch}),Intl,Date,setTimeout,clearTimeout,URLSearchParams,cashflowEntryHTML,fundingEntryHTML,budgetOverviewHTML,moneyReviewHTML,useFields,savingsEntryHTML:()=>'',bindSavingsEntry:()=>{},budgetEditorHTML:()=>'',bindBudgetEditor:()=>{},bindBudgetSettings:()=>{},bindUseFields:()=>{},budgetAck:()=>({}),navigationHTML,pendingCount,bindNavigation:()=>{},bindLedger:()=>{},bindExpenseChart:()=>{},bindPaymentRecovery:()=>{},bindSecurityDialogs:()=>{},mountExpenseChat:async()=>null,mountMarket:()=>{} ,pinField:()=>'',showResult:()=>{} ,document:{body:{classList:{add(){}}},querySelector:node,getElementById:id=>node('#'+id),querySelectorAll:()=>[]},window:{location:{search:'',assign:url=>{destination=url;}}},fetch:async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>path==='/api/state'?state:{url:'https://auth.openai.com/api/accounts/authorize?state=test'}};}});
  vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(node('#app').innerHTML,/退出登录/);
  assert.ok(!node('#app').innerHTML.includes('Continue with ChatGPT'));
  assert.equal(typeof node('#logout').onclick,'function');
});


