import {Accounts} from './accounts.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {readFileSync} from 'node:fs';
const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be between 1024 and 65535');
const url=`http://127.0.0.1:${port}`;
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8').replace(/^\uFEFF/,'')).version;
async function running(){try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1500)});const data=await r.json();return r.ok&&data.application==='FinGuard'?data:null;}catch{return null;}}
async function ready(){return (await running())?.version===version;}
function open(){if(process.platform==='win32')spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});console.log(`Open ${url}`);}
const existing=await running();
if(existing&&existing.version!==version){console.error(`FinGuard ${existing.version} is still running at ${url}. Close its command window (Ctrl+C), then run start.cmd again to start ${version}.`);process.exitCode=1;}
else if(existing){open();console.log('FinGuard is already running.');}
else {
  const dataFolder=process.env.FINGUARD_DATA_DIR||join(root,'.data');
  const accounts=new Accounts(dataFolder);const count=accounts.db.prepare('SELECT count(*) AS n FROM users').get().n;accounts.close();
  if(!count){const provision=spawnSync(process.execPath,[join(root,'provision.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});if(provision.status!==0)throw Error('Could not create test accounts.');console.log('Test credentials: '+join(dataFolder,'测试账号-请勿公开.txt'));}
  const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});
  let stopped=false;child.on('exit',()=>{stopped=true;});
  child.on('error',e=>{stopped=true;console.error('Start failed:',e.message);});
  process.on('SIGINT',()=>{child.kill();process.exit(0);});
  let available=false;
  for(let i=0;i<25&&!stopped;i++){if(await ready()){available=true;break;}await new Promise(r=>setTimeout(r,300));}
  if(available){open();console.log('Keep this window open. Press Ctrl+C to stop FinGuard.');}
  else {console.error('Could not start the local preview. Please share this message with the implementer.');child.kill();process.exitCode=1;}
}
