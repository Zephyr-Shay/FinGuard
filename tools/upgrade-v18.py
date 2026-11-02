from pathlib import Path
r=Path(__file__).resolve().parents[1]
p=r/'server.mjs';s=p.read_text(encoding='utf-8')
s="import {bankView,draftPlan,approvePlan,cancelPlan,tickBank,assessRisk,splitAA,markAA,periodReport} from './banking.mjs';\n"+s
s=s.replace("return async(req,res)=>{","const business=async(req,res)=>{",1)
s=s.replace("'/style.css':'style.css'","'/style.css':'style.css','/banking.html':'banking.html','/banking.js':'banking.js'")
s=s.replace("if(req.method==='GET'&&url.pathname==='/api/state')","if(req.method==='GET'&&url.pathname==='/api/banking'){json(res,200,{...bankView(engine.state),balance:engine.state.balance,contacts:engine.state.contacts,subscriptions:engine.state.subscriptions,user:req.user});return;}\n    if(req.method==='GET'&&url.pathname==='/api/report'){json(res,200,periodReport(engine.state,url.searchParams.get('period')||''));return;}\n    if(req.method==='GET'&&url.pathname==='/api/state')")
needle="if(url.pathname.startsWith('/api/personal/'))"
insert="""if(url.pathname==='/api/banking/plan'){json(res,200,commit(()=>draftPlan(engine.state,body)));return;}
    if(url.pathname==='/api/banking/risk'){json(res,200,commit(()=>assessRisk(engine.state,body.answers)));return;}
    if(url.pathname==='/api/banking/aa'){json(res,200,commit(()=>splitAA(engine.state,body)));return;}
    if(url.pathname==='/api/banking/aa-record'){json(res,200,commit(()=>markAA(engine.state,body.id,body.recipient)));return;}
    const bankMatch=url.pathname.match(/^\\/api\\/banking\\/plans\\/([a-f0-9-]+)\\/(approve|cancel)$/);
    if(bankMatch){const allowed=bankMatch[2]==='approve'?['token']:[];if(Object.keys(body).some(k=>!allowed.includes(k)))throw Error('不能修改已生成计划');json(res,200,commit(()=>bankMatch[2]==='approve'?approvePlan(engine.state,bankMatch[1],body.token):cancelPlan(engine.state,bankMatch[1])));return;}
    """
s=s.replace(needle,insert+needle)
s=s.replace("};\n}\nexport function createHandler", "};\nbusiness.tick=()=>{const before=structuredClone(engine.state);try{if(tickBank(engine.state))save();}catch(e){engine.state=before;console.error('Schedule tick failed:',e.message);}};return business;\n}\nexport function createHandler",1)
s=s.replace("['/','/app.js','/style.css']","['/','/app.js','/style.css','/banking.html','/banking.js']")
s=s.replace("handler.close=()=>accounts.close();return handler;", """const timer=options.scheduler===false?null:setInterval(()=>{for(const {id} of accounts.db.prepare('SELECT id FROM users').all()){if(!handlers.has(id))handlers.set(id,createBusinessHandler({...options,port,folder:join(folder,'users',id)}));handlers.get(id).tick();}},30000);timer?.unref();
 handler.close=()=>{if(timer)clearInterval(timer);accounts.close();};return handler;""")
s=s.replace("version:'1.7.0'","version:'1.8.0'");p.write_text(s,encoding='utf-8')
p=r/'core.mjs';s=p.read_text(encoding='utf-8').replace("version:'1.2.0'","version:'1.8.0'");s=s.replace("environment:'仅合成数据与模拟银行',","environment:'仅合成数据与模拟银行',bankingPlans:(this.state.banking?.plans||[]).map(p=>{const r=clone(p);delete r.token;delete r.binding;delete r.authorization;return r;}),");p.write_text(s,encoding='utf-8')
p=r/'public/app.js';s=p.read_text(encoding='utf-8').replace("</nav><div class=\"sidebar-bottom\">","<a class=\"text-button\" href=\"/banking.html\">计划 · 卡片 · 理财 →</a></nav><div class=\"sidebar-bottom\">").replace('V1.7','V1.8');p.write_text(s,encoding='utf-8')
p=r/'package.json';p.write_text(p.read_text(encoding='utf-8').replace('1.7.0','1.8.0'),encoding='utf-8')
