import {createHmac,randomBytes,createHash} from 'node:crypto';
import {existsSync,writeFileSync,readFileSync,chmodSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
export const payloadHash=value=>createHash('sha256').update(value).digest('hex');
const zero='0'.repeat(64),invalid=()=>Error('审计完整性校验失败，已停止写入，请核对备份');
// Detects edits without the key and accidental damage. A malicious host
// administrator still requires independent audit storage and external anchors.
export class AuditLedger{
 constructor(db,folder,{verify=true,readOnly=false}={}){
  this.db=db;if(!readOnly)db.exec('CREATE TABLE IF NOT EXISTS audit_chain(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,details TEXT NOT NULL,previous TEXT NOT NULL,hash TEXT NOT NULL); CREATE INDEX IF NOT EXISTS audit_state_owner ON audit_chain(owner,kind,seq);');
  const hasRows=Boolean(db.prepare('SELECT 1 FROM audit_chain LIMIT 1').get()),file=join(folder,'audit.key');
  if(!existsSync(file)){if(hasRows||readOnly)throw invalid();mkdirSync(folder,{recursive:true});try{writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}
  this.key=readFileSync(file);if(this.key.length!==32)throw invalid();if(!readOnly)chmodSync(file,0o600);if(verify)this.verify();
 }
 mac(row){return createHmac('sha256',this.key).update('FinGuard/audit/v1\n'+JSON.stringify([row.seq,row.at,row.owner,row.kind,row.details,row.previous])).digest('hex');}
 check(row){if(!row||this.mac(row)!==row.hash)throw invalid();return row;}
 verify(){const own=!this.db.isTransaction;if(own)this.db.exec('BEGIN');try{let count=0,previous=zero;for(const row of this.db.prepare('SELECT * FROM audit_chain ORDER BY seq').iterate()){if(row.seq!==++count||row.previous!==previous)throw invalid();this.check(row);previous=row.hash;}const counter=this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='audit_chain'").get()?.seq||0;if(counter!==count)throw invalid();if(own)this.db.exec('COMMIT');return {entries:count,lastHash:previous};}catch(e){if(own&&this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
 append(owner,kind,details){
  if(!this.db.isTransaction)throw Error('审计记录必须与业务在同一事务保存');
  const last=this.db.prepare('SELECT * FROM audit_chain ORDER BY seq DESC LIMIT 1').get();if(last)this.check(last);
  const counter=this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='audit_chain'").get()?.seq||0;if(counter!==(last?.seq||0))throw invalid();
  const row={seq:(last?.seq||0)+1,at:new Date().toISOString(),owner,kind,details:JSON.stringify(details),previous:last?.hash||zero};row.hash=this.mac(row);
  this.db.prepare('INSERT INTO audit_chain(seq,at,owner,kind,details,previous,hash) VALUES(?,?,?,?,?,?,?)').run(row.seq,row.at,row.owner,row.kind,row.details,row.previous,row.hash);return row.hash;
 }
 stateHead(owner){const row=this.db.prepare("SELECT * FROM audit_chain WHERE owner=? AND kind='state' ORDER BY seq DESC LIMIT 1").get(owner);if(!row)throw invalid();this.check(row);return JSON.parse(row.details);}
 checkpoint(){return {format:'FinGuard-audit-checkpoint-v1',createdAt:new Date().toISOString(),...this.verify()};}
}
