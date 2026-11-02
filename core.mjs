import {transferUse,canExecuteMoney} from './budget.mjs';
import {DEFAULT_CARD_LIMIT} from './limits.mjs';
import {amountEvidence,groundModelPlan} from './intent-guard.mjs';
import {resolveContact} from './contact-matching.mjs';
import {refineRecipientPlan} from './recipient-resolution.mjs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export const LIMIT = 100000;
export const TTL = 5 * 60 * 1000;
const clone = value => structuredClone(value);
export const money = cents => (cents / 100).toFixed(2);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const executionPermit=Symbol('executionPermit');

export function seed() {
  const bills = [
    ['10-01','房屋租金','居住',280000],['10-02','城市交通','交通',1800],
    ['10-02','晨光咖啡','餐饮',2800],['10-03','每日超市','生活',16850],
    ['10-03','云音乐','订阅',1800],['10-04','午间食堂','餐饮',3500],
    ['10-05','云盘空间','订阅',1200],['10-06','城市交通','交通',2400],
    ['10-06','视频会员','订阅',2500],['10-06','视频会员','订阅',2500],
    ['10-07','周末聚餐','餐饮',18600],['10-08','书店','学习',8800],
    ['10-09','每日超市','生活',9620],['10-10','午间食堂','餐饮',3200],
    ['10-11','城市交通','交通',2200],['10-12','晨光咖啡','餐饮',2600],
    ['09-03','云音乐','订阅',1800],['09-05','云盘空间','订阅',1200],
    ['09-06','视频会员','订阅',2500],['08-03','云音乐','订阅',1800],
    ['08-05','云盘空间','订阅',1200],['08-06','视频会员','订阅',2500]
  ].map((r,i)=>({id:`B${String(i+1).padStart(3,'0')}`,date:`2026-${r[0]}`,merchant:r[1],category:r[2],cents:r[3],note:'合成演示数据'}));
  return {version:1,balance:1856000,contacts:[
    {id:'lin',name:'林晓',alias:'小林',tail:'2681',description:'同学'},
    {id:'chen-a',name:'陈晨',alias:'小陈',tail:'1026',description:'同学'},
    {id:'chen-b',name:'陈宇',alias:'小陈',tail:'8839',description:'室友'}
  ],subscriptions:[
    {id:'music',name:'云音乐',cents:1800,next:'2026-11-03',status:'active'},
    {id:'cloud',name:'云盘空间',cents:1200,next:'2026-11-05',status:'active'},
    {id:'video',name:'视频会员',cents:2500,next:'2026-11-06',status:'active'}
  ],bills,tasks:[],orders:[],events:[]};
}

// Restricted deterministic planner used when a model has not been configured.
export function localPlan(message) {
  if (typeof message !== 'string' || message.length > 600 || !message.trim()) return {action:'unsupported'};
  if (/(忽略|绕过|跳过|不需要).{0,12}(规则|授权|确认|安全)|system\s*prompt/i.test(message)) return {action:'unsupported'};
  if(/名单|通讯录|联系人|收款人|转给谁|转账给谁/.test(message)&&!/\d|百|千/.test(message))return {action:'contacts'};
  if (/转账|转给|给.+转/.test(message)) {
    if (/定时|明天|下周|每月|分别|并且|然后|不要|别转|不转|如果/.test(message)) return {action:'unsupported'};
    if (/[\d][,，eE][\d]|\d\s*[万千百]/.test(message)) return {action:'unsupported'};
    if(/我?爸|父亲|爸爸|母亲|妈妈|我妈/.test(message))return {action:'collect',question:'我理解你想给家人转账，但还不知道对应哪个收款人。请提供已有联系人的姓名，并确认金额（例如：给林晓转200元）。尚未执行转账；执行前会核对当前卡片限额及验证要求。'};
    const amount=amountEvidence(message);
    if(['missing','ambiguous'].includes(amount.status))return {action:'collect',question:'请确认这次要转多少元，例如 300 元。金额确定后再核对收款人。'};
    if(amount.status!=='exact'||amount.values.length!==1)return {action:'unsupported'};
    const cents=amount.values[0];
    const names=['小林','林晓','小陈','陈晨','陈宇'].filter(n=>message.includes(n));
    if(names.length!==1) return {action:'unsupported'};
    return {action:'transfer',recipient:names[0],cents};
  }
  if (/取消|停掉|停止/.test(message) && /订阅|代扣|会员|音乐|云盘/.test(message)) {
    if (/不要|别取消|不取消|所有|全部|然后|并且/.test(message)) return {action:'unsupported'};
    const names=['云音乐','云盘空间','视频会员'].filter(n=>message.includes(n));
    return names.length===1 ? {action:'cancel',subscription:names[0]} : {action:'subscriptions'};
  }
  if (/账单|消费|支出|花[了在到]|花费/.test(message)) {
    if (/去年|上月|9月|九月|年度/.test(message)) return {action:'unsupported'};
    return {action:'bills'};
  }
  if (/订阅|代扣|续费/.test(message)) return {action:'subscriptions'};
  return {action:'chat',answer:'我可以陪你聊，也能帮你查收款人、分析账单、安排预算。当前没有连接大模型，自由问答能力有限；你可以打开通讯录或每日收支日历继续。'};
}

export class Engine {
  constructor(state=seed(), now=()=>Date.now()) {this.state=clone(state);this.now=now;for(const t of this.state.tasks){if(t.status==='collecting'){const next=this.state.tasks.slice(this.state.tasks.indexOf(t)+1).find(n=>n.createdAt>=t.createdAt&&(n.dialogue||[]).some((m,i,a)=>m.role==='user'&&m.content===t.message&&a[i+1]?.content===t.summary&&i<a.length-2));if(next){t.status='superseded';t.nextId=next.id;}}}}
  event(task,type,text,details={}) {
    const row={id:randomUUID(),taskId:task.id,time:new Date(this.now()).toISOString(),type,text,details:clone(details)};
    this.state.events.push(row);return row;
  }
  task(id) {const task=this.state.tasks.find(t=>t.id===id);if(!task)throw new Error('任务不存在');return task;}
  block(t,reason) {t.status='blocked';t.summary=reason;delete t.token;this.event(t,'blocked',reason);return this.publicTask(t);}
  arm(t) {
    t.status='approval';t.expiresAt=this.now()+TTL;t.token=randomBytes(24).toString('hex');t.fingerprint=this.binding(t);
    t.summary='请核对具体操作，只有批准后才会执行。';
    this.event(t,'approval_required','等待明确授权',{params:t.params,expiresAt:t.expiresAt});
  }
  unavailable(t,reason){t.status='unavailable';t.summary=reason;delete t.token;this.event(t,'unavailable',reason);return this.publicTask(t);}
  requestInformation(t,summary,reason='information_missing'){
    t.status='collecting';t.summary=summary;t.steps=['理解目标','补全信息后生成确认卡'];
    delete t.token;delete t.fingerprint;delete t.expiresAt;
    this.event(t,'clarification_requested',summary,{reason});return this.publicTask(t);
  }
  binding(t){return digest({id:t.id,action:t.action,params:t.params,expiresAt:t.expiresAt,target:t.action==='transfer'?this.state.contacts.find(c=>c.id===t.params.recipientId):this.state.subscriptions.find(s=>s.id===t.params.subscriptionId)});}
  bills() {
    const records=this.state.bills.filter(b=>b.date>='2026-10-01'&&b.date<='2026-10-12');
    const categories={};for(const row of records) categories[row.category]=(categories[row.category]||0)+row.cents;
    const groups=new Map();for(const row of records){const key=`${row.date}|${row.merchant}|${row.cents}`;groups.set(key,[...(groups.get(key)||[]),row]);}
    return {period:'2026年10月1日 - 12日（样例数据区间）',total:records.reduce((s,r)=>s+r.cents,0),categories,records,
      anomalies:[...groups.values()].filter(rows=>rows.length>1).map(rows=>({reason:'同日、同商户、同金额，疑似重复扣费，请核对。',ids:rows.map(r=>r.id),merchant:rows[0].merchant,cents:rows[0].cents}))};
  }
  subscriptions() {return this.state.subscriptions.map(s=>({...s,evidence:this.state.bills.filter(b=>b.merchant===s.name).map(b=>b.id)}));}
  plan(message, proposed=localPlan(message), mode='local', fault='none',history=[]) {
    if(mode==='model')proposed=groundModelPlan(message,refineRecipientPlan(message,proposed,{contacts:this.state.contacts}),{history,contacts:this.state.contacts});
    const t={id:randomUUID(),createdAt:this.now(),message,status:'planning',mode,action:proposed?.action,params:{},fault:['none','lost_response','before_execution'].includes(fault)?fault:'none'};
    this.state.tasks.push(t);this.event(t,'intent','收到用户目标',{message,planner:mode});
    if(proposed?.action==='collect'&&typeof proposed.question==='string'&&proposed.question.trim()&&proposed.question.length<=600)return this.requestInformation(t,proposed.question,proposed.guardReason);
    if(t.action==='chat'||t.action==='contacts'){
      t.status='success';t.summary=t.action==='contacts'?'这里是你已保存的模拟收款人。点选一位即可继续转账。':String(proposed.answer||'你可以继续问我，或者选择一个银行服务。').slice(0,4000);
      if(t.action==='contacts')t.result=clone(this.state.contacts);this.event(t,'answer','只读回答，未执行资金操作');return this.publicTask(t);
    }
    if(t.action==='deposit'){
      if(!Number.isSafeInteger(proposed.cents)||proposed.cents<=0||proposed.cents>100000000||this.state.balance+proposed.cents>1000000000)return this.unavailable(t,'请输入0至100万元之间的转入金额；模拟余额上限1000万元。');
      if(!['模拟工资卡','模拟储蓄卡'].includes(proposed.source))return this.unavailable(t,'请选择已有的模拟来源账户。');
      t.params={cents:proposed.cents,source:proposed.source};t.steps=['核对模拟来源与金额','等待你的确认','记录模拟转入回执'];this.arm(t);return this.publicTask(t);
    }
    if(!['transfer','cancel','bills','subscriptions'].includes(proposed?.action)) {this.event(t,'planner_validation_failed','规划动作未通过白名单校验',{action:String(proposed?.action||'').slice(0,40)});return proposed?.action==='unsupported'?this.unavailable(t,'暂时无法整理这项需求。请补充说明，或选择页面上的业务入口；本次未执行操作。'):this.block(t,'这次没有生成可用的操作，请重新说明要办理的业务；本次未执行操作。');}
    // The model may only select a known operation. It never supplies execution authority.
    if(t.action==='transfer') {
      if(proposed.cents==null)return this.requestInformation(t,'请确认这次要转多少元，例如 300 元。','amount_missing');
      if(!Number.isSafeInteger(proposed.cents)||proposed.cents<=0) return this.block(t,'转账金额需要大于 0，最多保留两位小数。请重新确认具体金额。');
      if(proposed.cents>(this.state.banking?.cards.find(c=>c.id==='main')?.limit||DEFAULT_CARD_LIMIT)) return this.unavailable(t,'超过当前卡片单笔限额，请到卡片与安全核对或调整限额。');
      if(proposed.cents>this.state.balance) return this.unavailable(t,'可用余额不足，暂时不能执行这笔转账。');
      const byId=this.state.contacts.filter(p=>p.id===proposed.recipient),contacts=byId.length?byId:resolveContact(proposed.recipient,this.state.contacts).matches;
      try{t.params={cents:proposed.cents,...transferUse(proposed)};}catch(e){return this.block(t,e.message);}t.steps=['理解转账目标','核对收款人和余额','等待你的批准','模拟执行并核对回执'];
      this.event(t,'plan','生成转账计划',{steps:t.steps});
      if(!contacts.length){t.status='collecting';t.summary='没有找到这位收款人，请在通讯录添加或选择已有联系人。金额已记录，请继续确认收款人。';this.event(t,'clarification_requested',t.summary);return this.publicTask(t);}
      if(contacts.length>1){t.status='clarify';t.candidates=contacts;t.summary='找到两位“小陈”，请先选择收款人。';this.event(t,'clarify','收款人有歧义，尚未请求执行');}
      else {t.params.recipientId=contacts[0].id;this.arm(t);}
    } else if(t.action==='cancel') {
      const s=this.state.subscriptions.find(s=>s.id===proposed.subscription||s.name===proposed.subscription);
      if(!s) return this.block(t,'未找到对应订阅，请先查看订阅列表。');
      if(s.status!=='active') return this.block(t,'这项模拟代扣已停止，不会重复取消。');
      t.params={subscriptionId:s.id};t.steps=['识别订阅与扣费证据','说明取消影响','等待你的批准','停止模拟代扣并核对状态'];
      this.event(t,'plan','生成订阅代扣取消计划',{steps:t.steps});this.arm(t);
    } else {
      t.steps=t.action==='bills'?['读取样例账单','程序计算分类合计','识别待核对交易','返回明细与证据']:['读取历史扣费','匹配周期性商户','展示续费和取消入口'];
      this.event(t,'plan','只读分析无需资金操作授权',{steps:t.steps});
      t.result=t.action==='bills'?this.bills():this.subscriptions();t.status='success';
      t.summary=t.action==='bills'?`样例区间支出 ¥${money(t.result.total)}，发现${t.result.anomalies.length}组待核对交易。`:'已找到3项演示订阅。停止代扣需要再次明确批准。';
      this.event(t,'result',t.summary,{result:t.result});
    }
    return this.publicTask(t);
  }
  clarify(id,recipientId) {
    const t=this.task(id);if(t.status!=='clarify') throw new Error('当前任务不需要选择收款人');
    if(!t.candidates.some(c=>c.id===recipientId)) throw new Error('收款人不在候选名单内');
    t.params.recipientId=recipientId;delete t.candidates;this.event(t,'clarified','用户选择了收款人',{recipientId});this.arm(t);return this.publicTask(t);
  }
  approve(id,token) {
    const t=this.task(id);
    if(t.status==='success'||t.status==='pending') return this.publicTask(t);
    if(t.status!=='approval') throw new Error('当前任务不能批准');
    if(typeof token!=='string'||token!==t.token) throw new Error('授权凭证无效');
    if(this.now()>=t.expiresAt) return this.block(t,'授权已过期，请重新发起任务。');
    if(this.binding(t)!==t.fingerprint) return this.block(t,'操作参数、对象或类型发生变化，旧授权已失效。请重新发起。');
    if(!['transfer','cancel','deposit'].includes(t.action))return this.block(t,'非白名单操作不得执行');
    if(t.action==='transfer'&&(!Number.isSafeInteger(t.params.cents)||t.params.cents<=0||!this.state.contacts.some(c=>c.id===t.params.recipientId)))return this.block(t,'收款人或金额复核失败');
    if(t.action==='transfer'&&this.state.banking){const c=this.state.banking.cards.find(c=>c.id==='main');if(!c||c.status!=='active'||t.params.cents>c.limit)return this.block(t,'付款卡状态或交易限额不允许执行');}
    if(t.action==='transfer'&&(t.params.cents>(this.state.banking?.cards.find(c=>c.id==='main')?.limit||DEFAULT_CARD_LIMIT)||t.params.cents>this.state.balance))return this.block(t,'执行前复核未通过：余额不足或金额超限。');
    if(t.action==='cancel'&&this.state.subscriptions.find(s=>s.id===t.params.subscriptionId)?.status!=='active')return this.block(t,'执行前复核发现该代扣已停止。');
    if(t.action==='deposit'&&(!Number.isSafeInteger(t.params.cents)||t.params.cents<=0||t.params.cents>100000000||this.state.balance+t.params.cents>1000000000||!['模拟工资卡','模拟储蓄卡'].includes(t.params.source)))return this.block(t,'转入参数复核失败');
    if(t.action==='transfer'&&!canExecuteMoney(this.state,t,this.now()))return this.block(t,'预算或最低保留金额需要重新核对并明确选择，未执行。');
    this.event(t,'approved','用户明确批准卡片所列动作',{params:t.params});delete t.token;
    if(t.fault==='before_execution'){t.status='pending';t.summary='模拟请求在执行前超时。状态待核对，请先查询原操作号。';this.event(t,'timeout',t.summary);return this.publicTask(t);}
    this.execute(t,executionPermit);
    if(t.fault==='lost_response'){t.status='pending';t.summary='模拟响应丢失：结果待核对，请勿重复发起。';this.event(t,'timeout',t.summary);}
    else this.finish(t);
    return this.publicTask(t);
  }
  execute(t,permit) {
    if(permit!==executionPermit)throw new Error('执行必须经过本次交易授权校验');
    const old=this.state.orders.find(o=>o.taskId===t.id);if(old)return old;
    const receipt={id:`FG-${randomUUID().slice(0,8).toUpperCase()}`,taskId:t.id,action:t.action,params:clone(t.params),time:new Date(this.now()).toISOString(),status:'success'};
    if(t.action==='transfer') {receipt.before=this.state.balance;this.state.balance-=t.params.cents;receipt.after=this.state.balance;}
    else if(t.action==='deposit'){receipt.before=this.state.balance;this.state.balance+=t.params.cents;receipt.after=this.state.balance;}
    else if(t.action==='cancel')this.state.subscriptions.find(s=>s.id===t.params.subscriptionId).status='cancelled';
    else throw new Error('执行器拒绝非白名单操作');
    this.state.orders.push(receipt);this.event(t,'executed','模拟银行已执行并持久记录操作',{receipt});return receipt;
  }
  finish(t) {const receipt=this.state.orders.find(o=>o.taskId===t.id);if(!receipt)throw new Error('没有可核对的回执');t.status='success';t.result=clone(receipt);t.summary=t.action==='deposit'?'模拟资金已转入，回执已核对。':t.action==='transfer'?'模拟转账成功，回执已核对。':'模拟代扣已停止。商户合同和退款不在本演示范围内。';this.event(t,'verified',t.summary,{receiptId:receipt.id});}
  reject(id) {const t=this.task(id);if(!['approval','clarify','collecting'].includes(t.status))throw new Error('当前状态不能否决');t.status='rejected';delete t.token;t.summary='你已否决，未执行任何资金或订阅变更。';this.event(t,'rejected',t.summary);return this.publicTask(t);}
  reconcile(id) {
    const t=this.task(id);if(t.status==='success')return this.publicTask(t);if(t.status!=='pending')throw new Error('当前任务无需核对');
    this.event(t,'reconcile','使用原操作号查询，未发起第二次执行',{operationId:t.id});
    if(this.state.orders.some(o=>o.taskId===id))this.finish(t);
    else {t.fault='none';this.event(t,'not_executed','已确认原操作未执行，需要重新批准');this.arm(t);t.summary='已确认没有执行。核对后可重新批准，不会自动重试。';}
    return this.publicTask(t);
  }
  publicTask(t) {
    const result=clone(t);delete result.fingerprint;
    result.contact=this.state.contacts.find(c=>c.id===t.params?.recipientId);
    result.subscription=this.state.subscriptions.find(s=>s.id===t.params?.subscriptionId);
    result.events=this.state.events.filter(e=>e.taskId===t.id);return result;
  }
  snapshot() {
    for(const t of this.state.tasks){if(t.status==='approval'&&this.now()>=t.expiresAt){t.status='expired';delete t.token;t.summary='确认已过期，未执行，请重新发起。';}}
    return {balance:this.state.balance,contacts:this.state.contacts,subscriptions:this.subscriptions(),bills:this.bills(),
      tasks:[...this.state.tasks].reverse().map(t=>this.publicTask(t)),orders:this.state.orders,
      counts:{executed:this.state.orders.length,blocked:this.state.tasks.filter(t=>t.status==='blocked').length,pending:this.state.tasks.filter(t=>['approval','clarify','pending','collecting'].includes(t.status)).length}};
  }
  evidence() {return {project:'FinGuard',version:'1.8.0',environment:'仅合成数据与模拟银行',bankingPlans:(this.state.banking?.plans||[]).map(p=>{const r=clone(p);delete r.token;delete r.binding;delete r.authorization;return r;}),exportedAt:new Date(this.now()).toISOString(),tasks:this.state.tasks.map(t=>{const r=clone(t);delete r.token;delete r.fingerprint;return r;}),events:clone(this.state.events),orders:clone(this.state.orders)};}
}

