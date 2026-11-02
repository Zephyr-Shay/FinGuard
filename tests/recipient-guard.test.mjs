import test from 'node:test';import assert from 'node:assert/strict';
import {groundModelPlan} from '../intent-guard.mjs';import {Engine} from '../core.mjs';
const contacts=new Engine().state.contacts;
const one=(recipient,cents)=>({action:'transfer',recipient,cents});
const many=xs=>({action:'banking',steps:xs.map(([recipient,cents])=>({kind:'transfer',recipient,cents}))});
const check=(message,plan,history=[])=>groundModelPlan(message,plan,{contacts,history});
test('逐笔配对拒绝对调、复用、漏项与加项，而非只比较金额是否出现',()=>{
 for(const pairs of [[['lin',50000],['chen-a',30000]],[['lin',50000],['chen-a',50000]],[['lin',30000]],[['lin',30000],['chen-a',50000],['lin',30000]]])assert.equal(check('给林晓转300元，给陈晨转500元',many(pairs)).guardReason,'recipient_amount_mismatch');
});
test('按收款人ID与金额比较，正确重排、别名与金额前置不被拦截',()=>{
 const p=many([['chen-a',50000],['lin',30000]]);
 for(const message of ['给林晓转300元，给陈晨转500元','给小林转300元；给陈晨转500元','给林晓转300元给陈晨转500元','转300元给林晓，转500元给陈晨'])assert.equal(check(message,p).action,'banking',message);
 assert.equal(check('给林晓和陈晨各转300元',many([['lin',30000],['chen-a',30000]])).action,'banking');
});
test('同一收款人多笔及重复金额保留逐笔数量约束',()=>{
 const text='给林晓转300元，再给林晓转500元';
 assert.equal(check(text,many([['lin',50000],['lin',30000]])).action,'banking');
 assert.equal(check(text,many([['lin',50000],['lin',50000]])).action,'collect');
 assert.equal(check('给林晓转300元，再给林晓转300元',many([['lin',30000],['lin',30000]])).action,'banking');
 assert.equal(check('给林晓转300元，再给林晓转300元',one('lin',30000)).action,'collect');
});
test('同名别名、总额分配和复杂分别语法不能猜测配对',()=>{
 for(const text of ['给小陈转300元','给林晓和陈晨总共转300元','给林晓和陈晨分别转300元和500元','给林晓转300元，陈晨各自处理'])assert.equal(check(text,many([['lin',30000],['chen-a',30000]])).action,'collect',text);
 for(const text of ['不要给林晓300元','不是林晓，给陈晨300元'])assert.equal(check(text,one('lin',30000)).action,'collect');
});
test('单笔对象同样必须对应用户点名的已有收款人',()=>{
 assert.equal(check('给林晓转300元',one('chen-a',30000)).guardReason,'recipient_amount_mismatch');
 assert.equal(check('给陈晨转300元',one('chen-b',30000)).action,'collect');
 assert.equal(check('给张三转300元',one('lin',30000)).action,'collect');
 assert.equal(check('给林晓转账，给张三500元',one('lin',50000)).action,'collect');
 assert.equal(check('给林晓300元，张三500元',many([['lin',30000]])).action,'collect');
 assert.equal(groundModelPlan('给林晓转300元',one(undefined,30000),{contacts:[{id:'lin',name:'林晓'}]}).action,'collect');
});
test('补充姓名、最终金额与修改对象沿用同一待补充会话，不相加',()=>{
 assert.equal(check('林晓',one('lin',20000),[{role:'user',content:'给我爸转200元'}]).action,'transfer');
 assert.equal(check('300元',one('lin',30000),[{role:'user',content:'给林晓转账'}]).action,'transfer');
 assert.equal(check('改成200元',one('lin',20000),[{role:'user',content:'给林晓转300元'}]).action,'transfer');
 assert.equal(check('陈晨',one('chen-a',30000),[{role:'user',content:'给林晓转300元'}]).action,'transfer');
});
test('助手示例、多个历史对象和尚未指明的家人不能补入配对',()=>{
 for(const history of [[{role:'assistant',content:'给林晓转300元'}],[{role:'user',content:'给林晓和陈晨转账'}],[{role:'user',content:'给林晓转账'},{role:'user',content:'给爸爸转账'}]])assert.equal(check('300元',one('lin',30000),history).action,'collect');
 assert.equal(check('林晓',one('lin',30000),[{role:'user',content:'给林晓300元，张三500元'}]).action,'collect');
});
test('追加与减少均追问最终总额，既不接受自动求和也不把增量当总额',()=>{
 const history=[{role:'user',content:'给林晓转300元'}];
 for(const message of ['再加200元','追加200元','减少200元'])for(const cents of [10000,20000,50000])assert.equal(check(message,one('lin',cents),history).guardReason,'amount_adjustment');
});
test('配对守卫不修改候选和账户资料，拒绝时不生成凭证或订单',()=>{
 const e=new Engine(),before=structuredClone(e.state),plan=one('chen-a',30000),copy=structuredClone(plan);
 const t=e.plan('给林晓转300元',plan,'model');assert.equal(t.status,'collecting');assert.equal(t.token,undefined);assert.equal(e.state.balance,before.balance);assert.deepEqual(e.state.contacts,before.contacts);assert.deepEqual(e.state.orders,[]);assert.deepEqual(plan,copy);
});
