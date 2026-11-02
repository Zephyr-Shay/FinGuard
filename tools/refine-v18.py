from pathlib import Path
r=Path(__file__).resolve().parents[1]
p=r/'server.mjs';s=p.read_text(encoding='utf-8');s="import {scenario} from './scenarios.mjs';\n"+s
s=s.replace("if(url.pathname==='/api/banking/plan')", "if(url.pathname==='/api/banking/scenario'){if(body.confirm!=='REPLACE_MY_DEMO')throw Error('需要明确确认替换本账号演示数据');commit(()=>{engine=new Engine(scenario(body.id));generation++;});json(res,200,{ok:true});return;}\n    if(url.pathname==='/api/banking/plan')")
p.write_text(s,encoding='utf-8')
p=r/'public/banking.html';s=p.read_text(encoding='utf-8').replace('<body>','<body class="banking-page">');p.write_text(s,encoding='utf-8')
p=r/'public/banking.js';s=p.read_text(encoding='utf-8').replace("aa:'AA分摊'","aa:'AA分摊',data:'演示场景'").replace("['不能接受','小幅损失','较大损失']","['很小损失','小幅损失','较大损失']")
s=s.replace("if(tab==='cards')html=", "if(tab==='data')html=`<h2>切换合成演示场景</h2><p>以下操作会替换当前账号的模拟账单、任务、持仓、余额与计划，不影响登录账号或其他用户。需要保留记录时，先返回工作台导出证据。</p><form id=\"form\"><label>选择数据<select name=\"scenario\"><option value=\"steady\">稳定预算 · 全年合成账单</option><option value=\"tight\">余额不足 · 高生活支出</option><option value=\"locked\">卡片锁定 · 执行前拦截</option></select></label><label><input type=\"checkbox\" name=\"confirm\" required>我确认替换本账号演示数据</label><button class=\"primary\">载入演示场景</button></form>`;\n if(tab==='cards')html=")
s=s.replace("if(tab==='cards')await plan", "if(tab==='data'){if(f.confirm!=='on')throw Error('请先确认');await api('/api/banking/scenario',{id:f.scenario,confirm:'REPLACE_MY_DEMO'});}\n  if(tab==='cards')await plan")
p.write_text(s,encoding='utf-8')
p=r/'public/style.css';s=p.read_text(encoding='utf-8')+'''
/* V1.8: business plans share the existing black/gold theme. */
.banking-page{line-height:1.65}.banking-page #tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:24px 0}.banking-page #tabs button{white-space:nowrap;padding:12px 8px}
.banking-page #form,.banking-page #risk{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin:22px 0}.banking-page label{display:flex;flex-direction:column;gap:7px;color:#cfc5ae;font-size:14px}
.banking-page label:has(input[type=checkbox]){display:flex;flex-direction:row;align-items:center;grid-column:1/-1}.banking-page input:not([type=checkbox]),.banking-page select{width:100%;min-width:0;border:1px solid #524a37;background:#11120f;color:#e9e2d2;padding:12px;border-radius:8px;font:inherit;color-scheme:dark}.banking-page input[type=checkbox]{width:18px;height:18px;accent-color:#bca36b}
.banking-page form p,.banking-page form h3{grid-column:1/-1}.banking-page form button{justify-self:start}.banking-page .panel{overflow-wrap:anywhere}.banking-page h2{margin-top:24px}.banking-page #plans label{margin:16px 0}.banking-page #plans ol{padding-left:22px}.banking-page #plans li{padding:8px 0;border-bottom:1px solid #333125}.banking-page #plans li p{color:#b8ab90;font-size:13px;margin:6px 0}
@media(max-width:650px){.banking-page #tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.banking-page #form,.banking-page #risk{grid-template-columns:1fr}.banking-page .actions{flex-wrap:wrap}.banking-page .actions button{min-width:85px;flex:1 1 85px}.banking-page main{margin-top:12px!important}.banking-page #content>.panel{padding:18px!important}}
''';p.write_text(s,encoding='utf-8')
p=r/'banking.mjs';s=p.read_text(encoding='utf-8').replace("return {kind:x.kind,card:x.card,...(x.kind==='limit'?{cents:Math.min(amount(x.cents),LIMIT)}:{})};","if(x.kind==='limit'&&amount(x.cents)>LIMIT)fail('限额不能超过模拟1000元上限');return {kind:x.kind,card:x.card,...(x.kind==='limit'?{cents:amount(x.cents)}:{})};");p.write_text(s,encoding='utf-8')
p=r/'compose.yaml';p.write_text(p.read_text(encoding='utf-8').replace('1.7.0','1.8.0'),encoding='utf-8')
