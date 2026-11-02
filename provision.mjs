import {Accounts} from './accounts.mjs';
import {randomBytes} from 'node:crypto';
import {writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const folder=resolve(process.env.FINGUARD_DATA_DIR||'.data');mkdirSync(folder,{recursive:true});
const output=resolve(process.argv[2]||join(folder,'测试账号-请勿公开.txt'));
if(existsSync(output))throw Error('账号清单已存在，不覆盖。');
const a=new Accounts(folder),rows=[];
try{for(let i=1;i<=10;i++){const username='tester'+String(i).padStart(2,'0');if(a.db.prepare('SELECT id FROM users WHERE username=?').get(username))continue;const password=randomBytes(12).toString('base64url');await a.create(username,password);rows.push(username+'\t'+password);}
if(rows.length)writeFileSync(output,'FinGuard 内测账号（仅管理员保管，逐人分发，勿发整个清单）\n账号\t初始密码\n'+rows.join('\n')+'\n\n账号仅适用于生成它们的数据库实例；密码无法从数据库还原。\n',{encoding:'utf8',flag:'wx'});
console.log('Created '+rows.length+' accounts. Credentials saved locally; not printed.');}finally{a.close();}
