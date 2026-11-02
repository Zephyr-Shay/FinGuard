import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AuditLedger,payloadHash} from '../audit.mjs';
const folder=resolve(process.env.FINGUARD_DATA_DIR||'.data'),file=join(folder,'accounts.sqlite'),args=process.argv.slice(2);
if(args.length&&!((args[0]==='--checkpoint'||args[0]==='--compare')&&args.length===2))throw Error('Usage: node tools/audit-check.mjs [--checkpoint new-file | --compare checkpoint-file]');
if(!existsSync(file))throw Error('Existing database required; nothing created.');
const db=new DatabaseSync(file,{readOnly:true});try{db.exec('BEGIN');const audit=new AuditLedger(db,folder,{readOnly:true}),checkpoint=audit.checkpoint();let states=0;
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='business_state'").get())for(const row of db.prepare('SELECT * FROM business_state').iterate()){const head=audit.stateHead(row.owner);if(row.hash!==payloadHash(row.payload)||head.revision!==row.revision||head.payloadHash!==row.hash)throw Error('Business state integrity mismatch');states++;}
 if(args[0]==='--compare'){const anchor=JSON.parse(readFileSync(resolve(args[1]),'utf8'));if(anchor.format!==checkpoint.format||!Number.isSafeInteger(anchor.entries)||anchor.entries<0||anchor.entries>checkpoint.entries||typeof anchor.lastHash!=='string')throw Error('Invalid or newer checkpoint');const known=anchor.entries?db.prepare('SELECT hash FROM audit_chain WHERE seq=?').get(anchor.entries)?.hash:'0'.repeat(64);if(known!==anchor.lastHash)throw Error('Independent checkpoint mismatch');}
 db.exec('COMMIT');if(args[0]==='--checkpoint')writeFileSync(resolve(args[1]),JSON.stringify(checkpoint,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({valid:true,...checkpoint,states,anchorCompared:args[0]==='--compare'}));
}finally{db.close();}
