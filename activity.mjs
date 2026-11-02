import {randomUUID} from 'node:crypto';
const labels={'/api/funding-assistant/preference':'确认资金安排偏好','/api/funding-assistant/use':'本次沿用已确认偏好','/api/funding-assistant/start':'开始统一资金安排','/api/funding-assistant/reply':'调整资金安排需求','/api/funding-assistant/preview':'生成统一安排预览','/api/funding-assistant/draft':'核对并创建统一安排','/api/transfers/classify':'调整转账统计用途','/api/transfers/classify-preview':'预览转账预算影响','/api/wealth-assistant/start':'开始理财对话','/api/wealth-assistant/reply':'补充理财需求','/api/wealth-assistant/preview':'生成产品比较与理财预览','/api/wealth-assistant/draft':'核对理财方案，进入安全确认','/api/auth/login':'登录','/api/auth/logout':'退出登录','/api/auth/password':'修改登录密码','/api/auth/payment':'设置或修改支付密码','/api/auth/payment/reset/check':'核验支付密码重设身份','/api/auth/payment/reset':'重设支付密码','/api/auth/mfa/begin':'申请绑定验证器','/api/auth/mfa/confirm':'确认绑定验证器','/api/security-policy':'修改小额验证设置','/api/banking/plan':'创建业务计划','/api/banking/risk':'保存风险评估','/api/banking/aa':'创建AA分摊','/api/banking/aa-record':'记录AA收款','/api/banking/scenario':'切换演示场景','/api/wealth/propose':'生成模拟理财方案','/api/wealth/draft':'将理财方案生成待确认交易','/api/import/preview':'预览账单导入','/api/import/commit':'确认账单导入','/api/import/report':'查看导入账单报告','/api/import/analyze':'分析导入账单','/api/analysis/review':'记录异常核对结果','/api/analysis/profile':'修改分析偏好','/api/analysis/clear':'清空当前分析','/api/analysis/chat':'分析账单','/api/market/analyze':'分析市场行情','/api/plan':'创建助手事项','/api/deposit':'申请模拟转入','/api/reset':'重置演示场景','/api/expense-chat/start':'开始整理开销','/api/expense-chat/reply':'补充开销信息','/api/expense-chat/save':'确认保存开销记录'};
function label(path){if(labels[path])return labels[path];if(/^\/api\/(banking\/plans|tasks)\/[a-f0-9-]+\/(approve|cancel|reject|clarify|reconcile|verify-pin|review|use)$/.test(path))return {review:'重新核对未完成转账',use:'调整待确认转账的统计用途','verify-pin':'验证转账支付密码',approve:'确认业务',cancel:'取消未执行步骤',reject:'拒绝业务',clarify:'补充业务信息',reconcile:'核对交易结果'}[path.split('/').at(-1)];if(/^\/api\/personal\/(expense|goal|budget|contact|profile)$/.test(path))return '保存或删除'+{expense:'账单事项',goal:'储蓄目标',budget:'预算',contact:'收款人',profile:'个人资料'}[path.split('/').at(-1)];return null;}
labels['/api/ai/settings']='修改外部AI数据授权';
export function activityStore(db,{audit=null}={}){
 db.exec('CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,label TEXT NOT NULL,status TEXT NOT NULL,error TEXT); CREATE INDEX IF NOT EXISTS activity_user_time ON activity(user_id,started);');
 const write=(owner,kind,details,action)=>{db.exec('BEGIN IMMEDIATE');try{action();audit?.append(owner,kind,details);db.exec('COMMIT');}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}};
 return {
  attach(req,res,user,path){
   const name=label(path);if(!name||req.method!=='POST'||!user)return;
   const id=randomUUID(),started=new Date().toISOString();
   write(user.id,'request.start',{id,started,label:name},()=>db.prepare('INSERT INTO activity VALUES(?,?,?,NULL,?,?,NULL)').run(id,user.id,started,name,'请求已接收，结果待核对'));
   const originalHead=res.writeHead.bind(res),originalEnd=res.end.bind(res);let status=200,headArgs=[],ended=false;
   // Save the finish record before sending headers. If auditing fails after a
   // business commit, report uncertainty and require original-receipt lookup.
   res.writeHead=(code,...args)=>{status=code;headArgs=args;return res;};
   res.end=(body,...args)=>{
    if(!ended){ended=true;let error=null;if(status>=400){try{error=String(JSON.parse(String(body)).error||'请求未完成').slice(0,400);}catch{error='请求未完成';}}
     const finished=new Date().toISOString();
     try{write(user.id,'request.finish',{id,finished,status},()=>db.prepare('UPDATE activity SET finished=?,status=?,error=? WHERE id=?').run(finished,status>=400?'请求未完成':'请求已处理（执行结果见业务记录）',error,id));}
     catch{status=503;body=JSON.stringify({error:'处理结果需要核对，请查询原操作记录，不要重复提交。'});console.error('Activity audit could not finish; original operation requires reconciliation.');}
     originalHead(status,...headArgs);
    }
    return originalEnd(body,...args);
   };
  },
  read(user,page){page=Number(page);if(!Number.isSafeInteger(page)||page<0||page>100000)page=0;return {rows:db.prepare('SELECT id,started,finished,label,status,error FROM activity WHERE user_id=? ORDER BY started DESC,rowid DESC LIMIT 50 OFFSET ?').all(user.id,page*50),total:db.prepare('SELECT count(*) AS n FROM activity WHERE user_id=?').get(user.id).n};}
 };
}
