export const fundProfiles=Object.freeze([
 {id:'fund_202301',code:'202301',name:'南方现金增利货币A',type:'货币基金',issuer:'南方基金',risk:1,url:'https://www.nffund.com/main/jjcp/fundproduct/202301.shtml',checked:'2026-10-27',note:'货币市场基金；低风险不等于保本。',live:false},
 {id:'fund_004672',code:'004672',name:'华夏短债债券A',type:'债券基金',issuer:'华夏基金',risk:2,url:'https://accountquery.chinaamc.com/fund/004672/',checked:'2026-10-27',note:'中低风险债券基金；净值可能下跌。',live:true},
 {id:'fund_000216',code:'000216',name:'华安黄金ETF联接A',type:'黄金ETF联接',issuer:'华安基金',risk:3,url:'https://www.huaan.com.cn/funds/000216/index.shtml',checked:'2026-10-27',note:'通过ETF联接基金参与黄金相关资产；净值会波动。',live:true}
]);
export function parseFundDisclosure(profile,html,now=Date.now()){
 if(typeof html!=='string'||html.length<1000||!html.includes(profile.code))throw Error('披露内容不完整');
 const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ');
 let date,nav;if(profile.code==='004672'){const match=html.match(/class="td"[^>]*>\s*(20\d{2}-\d{2}-\d{2})\s*<\/div>\s*<div class="td"[^>]*>\s*(\d+\.\d+)\s*<\/div>/);if(match)[,date,nav]=match;}else if(profile.code==='000216'){const match=text.match(/日期\s+(20\d{2}-\d{2}-\d{2})\s+单位净值\s+(\d+\.\d+)/);if(match)[,date,nav]=match;}
 if(!date||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>new Date(now+28800000).toISOString().slice(0,10)||!Number.isFinite(Number(nav))||Number(nav)<=0||Number(nav)>10000)throw Error('未取得有效的已披露净值');
 return {nav:Number(nav),navDate:date};
}
export function createFundService({fetcher=fetch,now=Date.now}={}){let cached=null,running=null,lastAttempt=0;const previous=new Map();
 const current=()=>cached||{fetchedAt:null,rows:fundProfiles.map(p=>({...p,available:false,notice:p.live?'净值尚未获取':'基础资料已核对，净值未接入'}))};
 async function get({force=false}={}){if(running)return running;if(lastAttempt&&now()-lastAttempt<(force?15000:300000))return current();lastAttempt=now();running=(async()=>{const rows=await Promise.all(fundProfiles.map(async p=>{if(!p.live)return {...p,available:false,notice:'展示已核对的产品资料；万份收益与七日年化暂未接入'};try{const r=await fetcher(p.url,{signal:AbortSignal.timeout(7000),redirect:'error'});if(!r.ok)throw Error('upstream');const bytes=await r.arrayBuffer();if(bytes.byteLength>500000)throw Error('size');const text=new TextDecoder(p.code==='004672'?'gb18030':'utf-8').decode(bytes),quote=parseFundDisclosure(p,text,now()),row={...p,...quote,available:true,fetchedAt:now(),stale:false,notice:'官方已披露单位净值，按净值日期展示；不作为模拟成交价格。'};previous.set(p.id,row);return row;}catch{return previous.has(p.id)?{...previous.get(p.id),stale:true,notice:'刷新失败，展示上次取得的披露数据。'}:{...p,available:false,stale:true,notice:'暂未取得官方净值；基础资料可查看，不补造数值。'};}}));cached={fetchedAt:now(),rows};return cached;})().finally(()=>running=null);return running;}
 return {get,current};
}
export const fundService=createFundService();
