import test from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../core.mjs';import {ledger,changePersonal} from '../personal.mjs';import {sortRecords} from '../public/ledger.js';
test('Ledger includes new successful movements, separates imports, excludes unexecuted redemptions and linked manual duplicates',()=>{
 const e=new Engine(),before=e.state.balance;
 e.state.orders.push({id:'new',action:'transfer',params:{cents:789,recipientId:'lin'},time:'2026-10-26T17:00:00Z',status:'success'},{id:'buy',action:'buy',params:{cents:10000},time:'2026-10-26T10:00:00Z',status:'success'},{id:'requested',action:'redeem',params:{cents:10000},time:'2026-10-26T11:00:00Z',status:'success'},{id:'settled',action:'redemption_settlement',params:{cents:10000},time:'2026-10-27T11:00:00Z',status:'success'});
 e.state.importedBills=[{key:'k',account:'工资卡',date:'2026-10-26',direction:'收入',cents:800000,merchant:'工资',category:'收入'}];
 changePersonal(e,'expense',{title:'关联消费',date:'2026-10-01',cents:1,category:'其他',status:'actual',linkedId:'B011'});
 const r=ledger(e);assert.equal(r.find(x=>x.id==='new').date,'2026-10-27');assert.equal(r.find(x=>x.id==='new').category,'转账');assert.equal(r.find(x=>x.id==='buy').kind,'investment');assert.ok(!r.some(x=>x.id==='requested'));assert.equal(r.find(x=>x.id==='settled').kind,'settlement');assert.equal(r.find(x=>x.id==='import:k').account,'import:工资卡');assert.equal(r.filter(x=>x.title==='关联消费').length,0);assert.equal(e.state.balance,before);
});
test('Ledger ordering is stable, exact by cents/time/category, never mutates original rows',()=>{
 const r=[{id:'a',date:'2026-10-26',time:'2026-10-26T10:00:00Z',cents:300,category:'餐饮'},{id:'b',date:'2026-10-26',time:'2026-10-26T11:00:00Z',cents:100,category:'交通'},{id:'c',date:'2026-10-25',cents:200,category:'餐饮'}];
 const ids=mode=>sortRecords(r,mode).map(x=>x.id);assert.deepEqual(ids('date-desc'),['b','a','c']);assert.deepEqual(ids('date-asc'),['c','a','b']);assert.deepEqual(ids('amount-desc'),['a','c','b']);assert.deepEqual(ids('amount-asc'),['b','c','a']);assert.deepEqual(r.map(x=>x.id),['a','b','c']);assert.equal(sortRecords(r,'category')[0].category,sortRecords(r,'category')[1].category);
});
