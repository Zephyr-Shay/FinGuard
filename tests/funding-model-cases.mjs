// Synthetic, dated cases. Expected outcomes are assertions over state, not prose matching.
import assert from 'node:assert/strict';
import {seed} from '../core.mjs';
import {initBank,today,approvePlan} from '../banking.mjs';
import {startFunding,replyFunding,applyFundingReply,previewFunding,applyFundingPreview,draftFunding,fundingFacts} from '../funding-agent.mjs';
export const evalNow=Date.now(),date=n=>today(evalNow+n*86400000);
const base={reserve:200000,earmarks:[{title:'电脑',cents:100000}],transfers:[{title:'房租',recipient:'lin',cents:300000,date:date(5),purpose:'expense',category:'居住'}],invest:true,horizon:90};
export async function evalFixture(setup='empty'){const s=seed();s.balance=1000000;s.bills=[];s.subscriptions=[];initBank(s).risk={level:2,at:evalNow};startFunding(s,evalNow);if(setup!=='empty'){const c=s.fundingChat,r=await replyFunding(s,c,'测试初始安排',{model:async()=>JSON.stringify({answer:'请核对',patch:{...base,...(setup==='completed'?{invest:false,transfers:[{...base.transfers[0],date:date(0)}]}:{})}}),now:evalNow});applyFundingReply(s,c.id,c.revision,r,evalNow);if(setup==='completed'){applyFundingPreview(s,c.id,c.revision,await previewFunding(s,c,{now:evalNow}),evalNow);const p=draftFunding(s,{id:c.id,revision:c.revision,token:c.token},evalNow);s.banking.plans[0].verificationLevel='red';approvePlan(s,p.id,p.token,evalNow);}}return s;}
const same=(a,b)=>assert.deepEqual(a,b),eq=(a,b)=>assert.equal(a,b),row=(s)=>s.fundingChat.candidate.transfers[0],candidate=s=>s.fundingChat.candidate;
const noTransfer=s=>eq(candidate(s).transfers.length,0);
export const fundingCases=[
 {id:'F01',name:'一段话安排付款生活费和目标',message:`${date(5)}给林晓转3000元房租，留2000元生活费，再预留1000元买电脑，剩下的钱比较理财，90天不用。`,check(s){eq(row(s).cents,300000);eq(row(s).date,date(5));eq(row(s).recipient,'lin');eq(candidate(s).reserve,200000);eq(candidate(s).earmarks.reduce((n,x)=>n+x.cents,0),100000);eq(candidate(s).invest,true);eq(candidate(s).horizon,90);eq(fundingFacts(s,s.fundingChat).available,400000);},preview:true},
 {id:'F02',name:'中文金额与别名',message:'明天给小林转三千元，留两千元生活费，暂不理财。',check(s){eq(row(s).cents,300000);eq(row(s).recipient,'lin');eq(row(s).date,date(1));eq(candidate(s).reserve,200000);eq(candidate(s).invest,false);}},
 {id:'F03',name:'小数金额精确到分',message:'今天给林晓转123.45元，留0元生活费，不理财。',check(s){eq(row(s).cents,12345);eq(row(s).date,date(0));eq(candidate(s).reserve,0);}},
 {id:'F04',name:'同别名收款人必须澄清',message:'明天给小陈转500元，留1000元生活费。',check(s){eq(row(s).recipient,null);assert.ok(fundingFacts(s,s.fundingChat).questions.some(x=>x.key==='recipient'));}},
 {id:'F05',name:'不能猜家人对应联系人',message:'明天给爸爸转500元，留1000元生活费。',check(s){eq(row(s).recipient,null);}},
 {id:'F06',name:'未给日期时追问',message:'给林晓转600元，留1000元生活费。',check(s){eq(row(s).date,null);assert.ok(fundingFacts(s,s.fundingChat).questions.some(x=>x.key==='date'));}},
 {id:'F07',name:'未给金额时追问',message:'明天给林晓转一笔钱，生活费留1000元。',check(s){eq(row(s).cents,null);assert.ok(fundingFacts(s,s.fundingChat).questions.some(x=>x.key==='amount'));}},
 {id:'F08',name:'未给生活费不替用户填数',message:'明天给林晓转1000元。',check(s){eq(candidate(s).reserve,null);}},
 {id:'F09',name:'只改生活费保留其余事项',setup:'base',message:'生活费改成2500元，房租和电脑预留不变。',check(s,b){eq(candidate(s).reserve,250000);same(candidate(s).transfers,b.transfers);same(candidate(s).earmarks,b.earmarks);}},
 {id:'F10',name:'只改付款日期',setup:'base',message:`房租的付款日期改为${date(7)}，金额和其他事项都不要变。`,check(s,b){eq(row(s).date,date(7));eq(row(s).id,b.transfers[0].id);eq(row(s).cents,300000);eq(candidate(s).reserve,200000);}},
 {id:'F11',name:'只改付款金额',setup:'base',message:'房租改成2800元，日期不变，别的不要动。',check(s,b){eq(row(s).cents,280000);eq(row(s).id,b.transfers[0].id);eq(row(s).date,b.transfers[0].date);same(candidate(s).earmarks,b.earmarks);}},
 {id:'F12',name:'取消待付事项不取消其他目标',setup:'base',message:'取消房租付款，生活费和电脑预留以及理财需求保留。',check(s,b){noTransfer(s);eq(candidate(s).reserve,b.reserve);same(candidate(s).earmarks,b.earmarks);eq(candidate(s).invest,true);}},
 {id:'F13',name:'只改目标预留',setup:'base',message:'电脑预留改成1500元，其他都不变。',check(s,b){eq(candidate(s).earmarks[0].cents,150000);eq(candidate(s).earmarks[0].id,b.earmarks[0].id);same(candidate(s).transfers,b.transfers);}},
 {id:'F14',name:'暂停理财保留付款',setup:'base',message:'这次不理财了，房租和预留都照旧。',check(s,b){eq(candidate(s).invest,false);same(candidate(s).transfers,b.transfers);eq(candidate(s).reserve,b.reserve);}},
 {id:'F15',name:'更改最早用钱时间',setup:'base',message:'理财这笔钱改成30天后就要用，其他安排不变。',check(s,b){eq(candidate(s).horizon,30);same(candidate(s).transfers,b.transfers);eq(candidate(s).reserve,b.reserve);}},
 {id:'F16',name:'指定理财投入上限',setup:'base',message:'理财只投1000元，剩余保留现金，房租和其他预留不要动。',check(s,b){eq(candidate(s).investBudget,100000);same(candidate(s).transfers,b.transfers);eq(candidate(s).reserve,b.reserve);},preview:true},
 {id:'F17',name:'只问计算原因不改需求',setup:'base',message:'为什么只能安排4000元理财？请只解释，不要修改安排。',check(s,b){same(candidate(s),b);}},
 {id:'F18',name:'否定新付款不添加转账',setup:'base',message:'不要给林晓额外转500元，现有房租不变，先只解释。',check(s,b){same(candidate(s),b);}},
 {id:'F19',name:'已过日期不能自动挪到今天',message:`${date(-2)}给林晓转500元，留0元生活费。`,check(s){eq(row(s).date,date(-2));assert.ok(fundingFacts(s,s.fundingChat).questions.some(x=>x.key==='date'));}},
 {id:'F20',name:'两笔不同付款保留各自日期',message:`${date(2)}给林晓转500元，${date(4)}给陈宇转300元，留1000元生活费，暂不理财。`,check(s){const t=candidate(s).transfers;eq(t.length,2);eq(t.find(x=>x.recipient==='lin').date,date(2));eq(t.find(x=>x.recipient==='chen-b').cents,30000);}},
 {id:'F21',name:'已完成付款不能改写',setup:'completed',message:'把已完成的房租付款改成2000元。',allowRules:true,check(s,b){same(candidate(s).transfers,b.transfers);}},
 {id:'F22',name:'超出余额先提示不生成交易',message:`${date(1)}给林晓转9500元，留2000元生活费。`,check(s){eq(row(s).cents,950000);assert.ok(fundingFacts(s,s.fundingChat).warnings.some(x=>x.includes('还差')));}},
 {id:'F23',name:'只留生活费不假装执行',message:'先留3000元生活费，其他还没想好。',check(s){eq(candidate(s).reserve,300000);noTransfer(s);eq(candidate(s).invest,false);}},
 {id:'F24',name:'缺口解释不新增付款',setup:'base',message:`请解释${date(6)}的预计资金缺口500元，结合已知付款提出调整建议。先只解释，不新增付款，也不修改或执行安排。`,check(s,b){same(candidate(s),b);}},
 {id:'F25',name:'只取消一个目标预留',setup:'base',message:'不买电脑了，把电脑预留去掉。生活费、房租和理财都保持原来那样。',check(s,b){eq(candidate(s).earmarks.length,0);same(candidate(s).transfers,b.transfers);eq(candidate(s).reserve,b.reserve);}},
 {id:'F26',name:'追加第二个目标不覆盖原目标',setup:'base',message:'再额外留500元旅游，原电脑预留1000元不变，其他也不变。',check(s,b){eq(candidate(s).earmarks.length,2);assert.ok(candidate(s).earmarks.some(x=>x.id===b.earmarks[0].id&&x.cents===100000));eq(candidate(s).earmarks.reduce((n,x)=>n+x.cents,0),150000);same(candidate(s).transfers,b.transfers);}}
];
