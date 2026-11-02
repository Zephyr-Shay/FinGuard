import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {AuditLedger,payloadHash} from './audit.mjs';
// Simulated balances, orders, receipts and task states share a transaction.
// The authenticated server uses the accounts DB; standalone handlers close their
// SQLite connection after each synchronous operation.
export class StateStore{
 constructor(folder,{db=null,audit=null,owner='standalone'}={}){
  mkdirSync(folder,{recursive:true});this.folder=folder;this.db=db;this.audit=audit;this.owner=owner;
  this.use((db,audit)=>{db.exec('CREATE TABLE IF NOT EXISTS business_state(owner TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL,updated TEXT NOT NULL);');audit.verify();});
 }
 use(fn){if(this.db)return fn(this.db,this.audit);const db=new DatabaseSync(join(this.folder,'business.sqlite'));try{db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');return fn(db,new AuditLedger(db,this.folder,{verify:false}));}finally{db.close();}}
 unpack(db,audit){const row=db.prepare('SELECT * FROM business_state WHERE owner=?').get(this.owner);if(!row){if(db.prepare("SELECT 1 FROM audit_chain WHERE owner=? AND kind='state' LIMIT 1").get(this.owner))throw Error('账户记录缺失，已停止操作');return null;}
  const head=audit.stateHead(this.owner);if(payloadHash(row.payload)!==row.hash||head.revision!==row.revision||head.payloadHash!==row.hash)throw Error('账户记录完整性校验失败，请核对备份');return {revision:row.revision,state:JSON.parse(row.payload)};
 }
 load(initial){return this.use((db,audit)=>{
  db.exec('BEGIN IMMEDIATE');try{const concurrent=this.unpack(db,audit);if(concurrent){db.exec('COMMIT');return concurrent;}
   const state=initial(),payload=JSON.stringify(state),hash=payloadHash(payload);db.prepare('INSERT INTO business_state VALUES(?,0,?,?,?)').run(this.owner,payload,hash,new Date().toISOString());audit.append(this.owner,'state',{revision:0,payloadHash:hash,source:'initial-or-legacy-json'});db.exec('COMMIT');return {revision:0,state};
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
 });}
 read(){return this.use((db,audit)=>{db.exec('BEGIN');try{const saved=this.unpack(db,audit);if(!saved)throw Error('账户记录缺失，已停止操作');db.exec('COMMIT');return saved;}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}});}
 commit(expected,action){return this.use((db,audit)=>{
  db.exec('BEGIN IMMEDIATE');try{const row=this.unpack(db,audit);if(!row||row.revision!==expected)throw Object.assign(Error('账户已在其他操作中更新，请重新核对原操作结果'),{status:409});
   const {state,result}=action();if(result&&typeof result.then==='function')throw Error('账务事务不能包含异步操作');const payload=JSON.stringify(state),hash=payloadHash(payload),revision=expected+1;
   db.prepare('UPDATE business_state SET revision=?,payload=?,hash=?,updated=? WHERE owner=? AND revision=?').run(revision,payload,hash,new Date().toISOString(),this.owner,expected);audit.append(this.owner,'state',{revision,payloadHash:hash});db.exec('COMMIT');return {revision,result};
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
 });}
}
