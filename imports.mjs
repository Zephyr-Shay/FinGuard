import {createHash,randomUUID} from 'node:crypto';
const fail=m=>{throw Error(m);},fingerprint=r=>createHash('sha256').update(JSON.stringify([r.account,r.date,r.direction,r.cents,r.merchant,r.reference])).digest('hex');
export const header=['账户','日期','收支类型','金额','交易对象','分类','流水号'];
export function parseCSV(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>200000)fail('CSV 文件须小于200KB');text=text.replace(/^\uFEFF/,'');let rows=[],row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)fail('CSV 引号格式不正确');quoted=true;}else if(c===','){row.push(cell);cell='';closed=false;}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';closed=false;}else{if(closed)fail('CSV 引号后只能是分隔符');cell+=c;}
 }if(quoted)fail('CSV 引号未闭合');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length<2||rows.length>501)fail('每次导入1至500条记录');if(JSON.stringify(rows.shift().map(x=>x.trim()))!==JSON.stringify(header))fail('请使用模板列：'+header.join('、'));
 return rows.map((r,i)=>{if(r.length!==7)fail(`第${i+2}行列数不正确`);const [account,date,direction,amount,merchant,category,reference]=r.map(x=>x.trim());if(!account||account.length>60||!merchant||merchant.length>100||category.length>30||reference.length>100)fail(`第${i+2}行名称过长或缺少账户、交易对象`);if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail(`第${i+2}行日期须为有效的 YYYY-MM-DD`);if(!['收入','支出','退款','账户互转'].includes(direction))fail(`第${i+2}行收支类型不支持`);if(!/^\d{1,7}(\.\d{1,2})?$/.test(amount))fail(`第${i+2}行金额须为正数，最多两位小数`);const [whole,frac='']=amount.split('.'),cents=Number(whole)*100+Number(frac.padEnd(2,'0'));if(cents<=0||cents>100000000)fail(`第${i+2}行金额超出范围`);const item={account,date,direction,cents,merchant,category:category||'未分类',reference};return {...item,key:fingerprint(item),line:i+2};});
}
export function previewImport(s,text,now=Date.now()){
 const seen=new Set((s.importedBills||[]).map(r=>r.key)),rows=parseCSV(text).map(r=>{const duplicate=seen.has(r.key);seen.add(r.key);return {...r,duplicate};});
 const p={id:randomUUID(),created:now,expires:now+600000,rows,status:'preview'};s.importPreviews=[...(s.importPreviews||[]),p].slice(-5);return p;
}
export function commitImport(s,id,now=Date.now()){
 const p=s.importPreviews?.find(p=>p.id===id);if(!p)fail('预览不存在，请重新上传');if(p.status==='imported')return p.result;if(p.expires<=now)fail('预览已过期，请重新上传');
 const seen=new Set((s.importedBills||[]).map(r=>r.key)),rows=p.rows.filter(r=>{if(seen.has(r.key))return false;seen.add(r.key);return true;});if((s.importedBills||[]).length+rows.length>5000)fail('最多保存5000条导入记录');
 s.importedBills=[...(s.importedBills||[]),...rows.map(({duplicate,line,...r})=>({...r,batch:id,importedAt:new Date(now).toISOString(),source:'import'}))];p.status='imported';p.result={count:rows.length,skipped:p.rows.length-rows.length,batch:id,at:now};s.events.push({id:randomUUID(),time:new Date(now).toISOString(),type:'bills.imported',text:'用户确认导入账单，模拟余额未改变',details:p.result});return p.result;
}
export function importReport(s,period,account){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)||typeof account!=='string')fail('请选择月份和导入账户');const rows=(s.importedBills||[]).filter(r=>r.date.startsWith(period)&&r.account===account),sum=d=>rows.filter(r=>r.direction===d).reduce((n,r)=>n+r.cents,0),income=sum('收入'),expense=sum('支出'),refund=sum('退款');return {period,account,rows,income,expense,refund,netExpense:expense-refund,transfer:sum('账户互转'),incomeKnown:rows.some(r=>r.direction==='收入'),scope:'仅统计已导入并确认的记录，可能不完整；退款和账户互转不计入收入，未推算真实账户余额。'};}
export function importSummary(r){const money=n=>'¥'+(n/100).toFixed(2);return `所选账户${r.account}在${r.period}共有${r.rows.length}条导入记录。支出${money(r.expense)}，退款${money(r.refund)}。`+(r.incomeKnown?`已标为收入的记录合计${money(r.income)}，收入减净支出为${money(r.income-r.netExpense)}。这不代表完整收入或账户余额，也不能据此认定消费合理或不合理。`:'没有已确认的收入记录，暂不能计算收支结余或支出收入比。')+r.scope;}
