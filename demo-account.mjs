// Explicit simulation-only account. Ordinary Accounts.create rules stay intact.
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';

export function demoLoginEnabled(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='demo_accounts'").get())return false;
 return Boolean(db.prepare('SELECT 1 FROM users u JOIN demo_accounts d ON d.user_id=u.id WHERE u.username=? AND d.salt=u.salt AND d.hash=u.hash').get('tester'));
}

export function createTester(db){
 db.exec('CREATE TABLE IF NOT EXISTS demo_accounts(user_id TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL)');
 db.exec('BEGIN IMMEDIATE');
 try{
  const existing=db.prepare('SELECT id FROM users WHERE username=?').get('tester');
  if(existing){
   if(!demoLoginEnabled(db))throw Error('tester账号已存在或口令已修改；不会覆盖现有账号。');
   db.exec('COMMIT');return {created:false,username:'tester'};
  }
  const id=randomUUID(),salt=randomBytes(16).toString('hex'),hash=scryptSync('tester',salt,64).toString('hex');
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,'tester',salt,hash);
  db.prepare('INSERT INTO demo_accounts VALUES(?,?,?,?)').run(id,salt,hash,new Date().toISOString());
  db.exec('COMMIT');return {created:true,username:'tester'};
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
}
