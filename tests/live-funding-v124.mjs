// Administrator-invoked model check. Synthetic in-memory account only; never opens the user database.
import assert from 'node:assert/strict';
import {seed} from '../core.mjs';
import {initBank,today} from '../banking.mjs';
import {startFunding,replyFunding,applyFundingReply,previewFunding,applyFundingPreview} from '../funding-agent.mjs';
import {modelConfigured,structuredMessage} from '../planner.mjs';
if(!modelConfigured())throw Error('No model configured; do not claim a live-model pass.');
const s=seed();s.balance=1_000_000;s.bills=[];s.subscriptions=[];initBank(s).risk={level:2,at:Date.now()};startFunding(s);
const began=Date.now();let c=s.fundingChat;
const message='下月5号给林晓转3000元房租，留2000元生活费，再预留1000元买电脑，剩下的钱比较理财，90天不用。';
const reply=await replyFunding(s,structuredClone(c),message,{model:structuredMessage});assert.equal(reply.mode,'model');applyFundingReply(s,c.id,c.revision,reply);
assert.equal(c.candidate.reserve,200000);assert.equal(c.candidate.transfers.length,1);assert.equal(c.candidate.transfers[0].recipient,'lin');assert.equal(c.candidate.transfers[0].cents,300000);assert.equal(c.candidate.earmarks.reduce((n,x)=>n+x.cents,0),100000);assert.equal(c.candidate.invest,true);assert.equal(c.candidate.horizon,90);
const parsedAt=Date.now();const p=await previewFunding(s,structuredClone(c),{model:structuredMessage});assert.equal(p.mode,'model');assert.ok(p.investment<=400000&&p.investment>=0);applyFundingPreview(s,c.id,c.revision,p);
const first=p.investment,previewedAt=Date.now();const second=await replyFunding(s,structuredClone(c),'生活费改成2500元，房租日期和电脑预留不要变，重新看看方案',{model:structuredMessage});assert.equal(second.mode,'model');applyFundingReply(s,c.id,c.revision,second);assert.equal(c.candidate.reserve,250000);assert.equal(c.candidate.transfers[0].cents,300000);assert.equal(c.candidate.earmarks.reduce((n,x)=>n+x.cents,0),100000);assert.equal(c.preview,undefined);
assert.equal(s.balance,1000000);assert.equal(s.orders.length,0);assert.equal(s.banking.plans.length,0);
console.log(JSON.stringify({checkedAt:new Date().toISOString(),scope:'synthetic in-memory state only; no user database, login or transaction',mode:'actual configured model',parsed:{reserve:c.candidate.reserve,transferCents:c.candidate.transfers[0].cents,date:c.candidate.transfers[0].date,earmarked:100000,horizon:c.candidate.horizon},firstInvestmentCents:first,revisionPreservedUnchangedItems:true,stalePreviewRemoved:true,orders:0,timingsMs:{understand:parsedAt-began,preview:previewedAt-parsedAt,revise:Date.now()-previewedAt,total:Date.now()-began}},null,2));
