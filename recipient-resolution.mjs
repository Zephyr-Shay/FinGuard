import {resolveContact} from './contact-matching.mjs';
import {amountEvidence} from './intent-guard.mjs';

// Only complete, immediate transfer clauses qualify for this deterministic
// correction. Conditions, dates, budget changes and conversation references
// stay with the planner and the existing clarification/validation path.
export function refineRecipientPlan(message,plan,{contacts=[],today}={}){
 if(plan?.action!=='collect')return plan;
 const clauses=String(message||'').normalize('NFKC').trim().replace(/[。！!]$/,'').split(/[，,；;]/);
 if(!clauses.length||clauses.length>12)return plan;
 const steps=[];
 for(const clause of clauses){
  const m=clause.trim().match(/^(?:请)?(?:给|向)(.{1,30}?)(?:转账|转)\s*([\d零〇一二两三四五六七八九十百千万亿点.]+)\s*(?:元|块(?:钱)?)?$/);
  if(!m)return plan;
  const amount=amountEvidence(clause),resolved=resolveContact(m[1],contacts);
  if(amount.status!=='exact'||amount.values.length!==1||!resolved.matches.length)return plan;
  if(resolved.matches.length>1)return {action:'collect',question:`“${m[1]}”这个${resolved.kind==='name'?'姓名':'别名'}对应多位联系人：${resolved.matches.map(c=>c.name+'（尾号'+c.tail+'）').join('、')}。请确认具体收款人。`,guardReason:'recipient_ambiguous'};
  steps.push({kind:'transfer',recipient:resolved.matches[0].id,cents:amount.values[0],reserve:0,includeSubscriptions:false});
 }
 if(steps.length===1)return {action:'transfer',recipient:steps[0].recipient,cents:steps[0].cents};
 if(typeof today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(today))return plan;
 return {action:'banking',title:'逐笔转账',steps:steps.map(step=>({...step,date:today}))};
}
