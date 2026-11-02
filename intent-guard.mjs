// Local evidence for model-proposed transfers. Never infer an amount from an
// assistant reply, a contact number, an example, or a vague instruction.
import {contactLabels,resolveContact} from './contact-matching.mjs';
const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
const cn='零〇一二两三四五六七八九十百千万亿';
const num=`(?:[+-]?\\d+(?:\\.\\d+)?(?:百|千|万|亿)?|[负]?${'['+cn+']'}+(?:点[零〇一二三四五六七八九]+)?)`;
const vague=/几(?:十|百|千|万|块|元)|多少|若干|一些|点钱|随便|随意|看着办|左右|上下|大概|大约|差不多|不超过|最多|至少|[\d一二三四五六七八九十百千万]+\s*(?:到|至|~|～|—|-)\s*[\d一二三四五六七八九十百千万]+/;
const transferIntent=/转账|转给|给.{1,40}转|打给|汇给/;
const unsafeIntent=/(?:忽略|绕过|跳过|不需要).{0,12}(?:规则|授权|确认|安全)|system\s*prompt|伪造.{0,8}(?:用户|授权)|打印.{0,8}(?:系统|提示)/i;
const noTransfer=/(?:不要|别|不再|不用|不需要|不必|取消|不想).{0,12}(?:转|汇|打钱|给)|不转|不是|别选|不要选|不选|排除/;
function chineseInteger(s){
 if(!s)return 0;
 for(const [large,scale]of [['亿',100000000],['万',10000]])if(s.includes(large)){
  const parts=s.split(large);if(parts.length!==2||!parts[0])return null;
  if(parts[1]&&!/^[零〇]/.test(parts[1])&&!new RegExp(large==='亿'?'[十百千万]':'[十百千]').test(parts[1]))return null;
  const left=chineseInteger(parts[0]),right=chineseInteger(parts[1]);return left===null||right===null?null:left*scale+right;
 }
 let total=0,digit=null,lastUnit=10000;
 for(const ch of s){
  if(ch in digits){if(digit!==null&&digit!==0)return null;digit=digits[ch];continue;}
  const unit={十:10,百:100,千:1000}[ch];if(!unit||unit>=lastUnit||digit===0)return null;
  if(digit===null&&!(ch==='十'&&total===0))return null;
  total+=(digit??1)*unit;digit=null;lastUnit=unit;
 }
 // “三千五” is deliberately not assumed to mean 3500 or 3005.
 if(digit!==null&&lastUnit>10&&lastUnit<10000&&!s.includes('零')&&!s.includes('〇'))return null;
 return total+(digit??0);
}
function cents(raw){
 if(/^[+-]?\d/.test(raw)){
  const m=raw.match(/^([+-]?)(\d+)(?:\.(\d+))?([百千万亿])?$/);if(!m||m[1]==='-'||(m[3]?.length||0)>2)return null;
  const scale={百:100n,千:1000n,万:10000n,亿:100000000n}[m[4]]||1n;
  const n=(BigInt(m[2])*100n+BigInt((m[3]||'').padEnd(2,'0')))*scale;
  return n>0n&&n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;
 }
 if(raw.startsWith('负'))return null;
 const [whole,decimal]=raw.split('点'),n=chineseInteger(whole);
 if(n===null||(decimal?.length||0)>2)return null;
 const fraction=decimal?[...decimal].map(c=>digits[c]).join('').padEnd(2,'0'):'0';
 const value=n*100+Number(fraction);return Number.isSafeInteger(value)&&value>0?value:null;
}
function amountMatches(message){
 const found=[];
 const collect=re=>{for(const m of message.matchAll(re))found.push({start:m.index,end:m.index+m[0].length,raw:m.groups.amount});};
 collect(new RegExp(`(?<![\\d.${cn}])(?<amount>${num})\\s*(?:元|块(?:钱)?)`,'g'));
 collect(new RegExp(`(?:¥|￥|人民币)\\s*(?<amount>${num})`,'g'));
 collect(new RegExp(`(?:转账?|汇款?|打钱?)\\s*(?<amount>${num})(?![\\d${cn}点.年月日号])`,'g'));
 const bare=message.match(new RegExp(`^(?:那就|就|改成|改为|换成|金额(?:是|为)?|转)?\\s*(?<amount>${num})\\s*(?:元|块(?:钱)?)?[吧啊呀。！!]?$$`));
 if(bare)found.push({start:0,end:message.length,raw:bare.groups.amount});
 return found.filter((m,i)=>!found.slice(0,i).some(n=>m.start<n.end&&m.end>n.start)).sort((a,b)=>a.start-b.start);
}
export function amountEvidence(input){
 const message=String(input||'').normalize('NFKC').trim();
 if(/美元|美金|欧元|港币|日元|英镑|USD|EUR|HKD|JPY|GBP|\$/i.test(message))return {status:'ambiguous',values:[]};
 if(vague.test(message.replace(/\b20\d\d-\d\d-\d\d\b/g,'日期')))return {status:'ambiguous',values:[]};
 if(/\d[,，]\d|\d[eE][+-]?\d/.test(message))return {status:'invalid',values:[]};
 if(/例如|比如|举例|假如|假设/.test(message))return {status:'ambiguous',values:[]};
 const unique=amountMatches(message);
 if(!unique.length)return {status:'missing',values:[]};
 const values=unique.map(m=>cents(m.raw));
 if(values.some(v=>v===null))return {status:'invalid',values:[]};
 return {status:'exact',values};
}
function evidence(message,history){
 const latest=amountEvidence(message);if(latest.status!=='missing')return {...latest,text:message};
 for(const turn of [...history].reverse())if(turn.role==='user'){
  if(noTransfer.test(turn.content||''))return {status:'missing',values:[]};
  const previous=amountEvidence(turn.content);if(previous.status!=='missing')return {...previous,text:turn.content};
 }
 return latest;
}
const question='请确认这次要转多少元，例如 300 元。金额确定后再核对收款人。';
const collect=reason=>({action:'collect',question,guardReason:reason});
const normalize=x=>String(x||'').normalize('NFKC').trim();
const escapeRE=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function mentions(text,names){
 const found=[];
 for(const [name,ids]of names)for(let at=text.indexOf(name);at>=0;at=text.indexOf(name,at+1))found.push({start:at,end:at+name.length,ids});
 found.sort((a,b)=>a.start-b.start||b.end-a.end);
 const chosen=[];for(const hit of found)if(!chosen.some(x=>hit.start<x.end&&hit.end>x.start))chosen.push(hit);
 return {ids:[...new Set(chosen.flatMap(x=>[...x.ids]))],ambiguous:chosen.some(x=>x.ids.size!==1)};
}
function sourceBindings(text,names){
 text=normalize(text);const all=mentions(text,names),amounts=amountMatches(text);
 if(all.ambiguous)return null;
 const labels=[...names.keys()].sort((a,b)=>b.length-a.length).map(escapeRE).join('|');
 if(!labels)return null;
 const each=new RegExp(`^(?:请)?(?:给|向)?(?:${labels})(?:\\s*(?:和|、|以及|与|,|，)\\s*(?:${labels}))+\\s*(?:各(?:自)?|每人)\\s*(?:转账?|汇款?|打钱?)?\\s*${num}\\s*(?:元|块(?:钱)?)?[吧。！!]?$`);
 if(/各(?:自)?|每人/.test(text))return all.ids.length>1&&amounts.length===1&&each.test(text)?all.ids.map(id=>[id,cents(amounts[0].raw)]):null;
 const clauses=text.split(/[，,。；;、！!？?\n]|(?:然后|并且|接着)/).flatMap(part=>{
  const people=mentions(part,names),values=amountMatches(part);
  return people.ids.length===1&&values.length===1?[part]:part.split(new RegExp(`(?=(?:再)?(?:给|向)(?:${labels}))|和(?=(?:${labels}))`));
 });
 const pairs=[];
 for(const clause of clauses.filter(x=>x.trim())){
  const people=mentions(clause,names),values=amountMatches(clause);
  if(people.ambiguous)return null;
  if(!people.ids.length){
   const remaining=clause.replace(/20\d\d-\d\d-\d\d|\d{1,4}年|\d{1,2}[月日号]/g,'');
   if(values.length||transferIntent.test(clause)||/[\d零〇一二两三四五六七八九十百千万亿元块¥￥]/.test(remaining))return null;
   continue;
  }
  if(people.ids.length!==1||values.length!==1)return null;
  pairs.push([people.ids[0],cents(values[0].raw)]);
 }
 return pairs.length?pairs:null;
}
function bindings(message,source,history,contacts){
 const names=contactLabels(contacts),current=mentions(normalize(message),names);
 const bare=new RegExp(`^(?:那就|就|改成|改为|换成|金额(?:是|为)?|最终(?:共)?(?:转)?|转)?\\s*${num}\\s*(?:元|块(?:钱)?)?[吧啊呀。！!]?$$`);
 const explicit=sourceBindings(source.text,names);
 // A follow-up may name the payee after an earlier exact amount, or supply a
 // new final amount for a previously named payee. Never add historical amounts.
 const family=new RegExp(`^(?:请)?(?:给|向)(?:我?爸|爸爸|父亲|我?妈|妈妈|母亲)(?:转账?|汇款?|打钱?)?\\s*${num}\\s*(?:元|块(?:钱)?)?[吧啊呀。！!]?$$`);
 if(source.values.length===1&&!current.ambiguous&&current.ids.length===1&&normalize(source.text)!==normalize(message)&&(explicit?.length===1||bare.test(normalize(source.text))||family.test(normalize(source.text))))return [[current.ids[0],source.values[0]]];
 if(explicit)return explicit;
 if(source.values.length!==1||!bare.test(normalize(message)))return null;
 for(const turn of [...history].reverse())if(turn.role==='user'){
  const people=mentions(normalize(turn.content),names);
  if(people.ids.length||transferIntent.test(turn.content||''))return !people.ambiguous&&people.ids.length===1?[[people.ids[0],source.values[0]]]:null;
 }
 return null;
}
export function groundModelPlan(message,plan,{history=[],contacts=[]}={}){
 if(!plan||typeof plan!=='object'||Array.isArray(plan))return {action:'unsupported'};
 if(unsafeIntent.test(message))return {action:'unsupported'};
 const action=plan.action,transfers=action==='banking'&&Array.isArray(plan.steps)?plan.steps.filter(s=>s?.kind==='transfer'):action==='transfer'?[plan]:[];
 if(transfers.length&&noTransfer.test(message))return {action:'collect',question:'这次不会继续生成转账确认。请说明你希望查询什么，或重新描述要办理的业务。',guardReason:'transfer_negated'};
 if(transfers.length){
  if(/再加|追加|加上|增加|多转|再减|减去|减少|少转/.test(message))return {action:'collect',question:'请确认这次最终要转的总金额和收款人。我不会把历史金额自动相加或相减；本次尚未执行。',guardReason:'amount_adjustment'};
  const source=evidence(message,history);
  if(source.status==='invalid')return transfers.some(t=>!Number.isSafeInteger(t.cents)||t.cents<=0)?plan:{action:'collect',question:'转账金额需要大于 0，最多保留两位小数。请重新确认具体金额。',guardReason:'amount_invalid'};
  if(source.status!=='exact')return collect('amount_'+source.status);
  if(transfers.some(t=>t.cents==null))return collect('plan_amount_missing');
  if(transfers.some(t=>Number.isSafeInteger(t.cents)&&t.cents>0&&!source.values.includes(t.cents)))return collect('amount_mismatch');
  if(action==='transfer'&&source.values.length!==1)return collect('amount_multiple');
  const expected=bindings(message,source,history,contacts);
  const actual=transfers.map(t=>{if(typeof t.recipient!=='string'||!t.recipient.trim())return null;const byId=contacts.filter(c=>c.id===t.recipient),matches=byId.length?byId:resolveContact(t.recipient,contacts).matches;return matches.length===1?[matches[0].id,t.cents]:null;});
  // Compare a multiset of (payee ID, cents). Reordering is harmless; swapping,
  // reusing, dropping or inventing a pair must not produce confirmation tokens.
  const keys=xs=>xs.map(x=>JSON.stringify(x)).sort();
  if(!expected||actual.some(x=>!x)||JSON.stringify(keys(expected))!==JSON.stringify(keys(actual)))return {action:'collect',question:'请逐笔确认收款人与金额，例如“给林晓转300元，给陈晨转500元”。目前无法核实每笔对应关系，本次尚未执行。',guardReason:'recipient_amount_mismatch'};
 }
 const allowed=['collect','chat','contacts','deposit','transfer','cancel','bills','subscriptions','banking','wealth','funding','unsupported'];
 if(!allowed.includes(action)&&transferIntent.test(message)&&!['exact','invalid'].includes(evidence(message,history).status))return collect('unrecognized_transfer');
 return plan;
}
