// Explicitly invoked live evaluation. No Accounts import, database, authentication, or live transactions.
import {modelConfigured,structuredMessage} from '../planner.mjs';
import {replyFunding,applyFundingReply,previewFunding,applyFundingPreview} from '../funding-agent.mjs';
import {fundingCases,evalFixture,evalNow} from './funding-model-cases.mjs';
import assert from 'node:assert/strict';
if(!modelConfigured())throw Error('No configured model: a fixture run cannot be reported as a live-model evaluation.');
const selected=process.env.FINGUARD_EVAL_CASES?.split(','),cases=fundingCases.filter(x=>!selected||selected.includes(x.id)),results=[];
const started=Date.now();
for(const item of cases){const s=await evalFixture(item.setup),before=structuredClone(s.fundingChat.candidate),funds={balance:s.balance,orders:structuredClone(s.orders),banking:structuredClone(s.banking)},at=Date.now();let calls=0,result,preview=null,error;
 const model=async(...args)=>{calls++;return structuredMessage(...args);};
 try{const c=s.fundingChat;result=await replyFunding(s,structuredClone(c),item.message,{model,now:evalNow});applyFundingReply(s,c.id,c.revision,result,evalNow);item.check(s,before);assert.ok(calls>=1,'must call the actual configured model');if(item.preview){preview=await previewFunding(s,structuredClone(c),{model,now:evalNow});assert.equal(preview.mode,'model');assert.ok(preview.investment<=s.balance-preview.protectedCents);applyFundingPreview(s,c.id,c.revision,preview,evalNow);}assert.equal(s.balance,funds.balance);assert.deepEqual(s.orders,funds.orders);assert.deepEqual(s.banking,funds.banking);}catch(e){error=e.message;}
 results.push({id:item.id,name:item.name,message:item.message,passed:!error,mode:result?.mode,calls,elapsedMs:Date.now()-at,expected:item.check.toString(),observed:s.fundingChat.candidate,preview:preview?{investment:preview.investment,protectedCents:preview.protectedCents,projectedEnd:preview.projectedEnd,mode:preview.mode}:null,...(error?{error}:{} )});
}
const times=results.map(x=>x.elapsedMs).sort((a,b)=>a-b),report={checkedAt:new Date().toISOString(),scope:'synthetic in-memory accounts only; no user database, login, transaction or external bank',method:'26 fixed task cases, one run per case; deterministic assertions over candidate state, clarification, amounts, dates, preservation and no money movement; task success includes a correct explicit rule fallback, counted separately from accepted model output; selected cases additionally validate actual model allocation',caseCount:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,modelAccepted:results.filter(x=>x.mode==='model').length,fallbackCases:results.filter(x=>x.mode!=='model').map(x=>x.id),modelCalls:results.reduce((n,x)=>n+x.calls,0),totalMs:Date.now()-started,medianMs:times[Math.floor(times.length/2)],results};
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
