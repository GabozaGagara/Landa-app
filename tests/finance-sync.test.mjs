import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeFinanceBackups} from '../js/landa-finance-sync-core.mjs';

const clone=v=>structuredClone(v);
const invoice=(id,number,total=100)=>({id,supplierId:'anna',number,tracking:number,
 date:'2026-11-06',status:'created',accrued:false,total,items:[{name:'Товар',qty:1,price:total}]});
const payment=(id,amount=100)=>({id,supplierId:'anna',date:'2026-11-06',amount});
const base=()=>({app:'LANDA-suite',backupVersion:3,createdAt:'2026-11-05T00:00:00Z',
 proschet:{version:1,groups:[{id:'office',label:'Офис',included:true}],
  snapshots:[{id:'INIT',label:'Начало',date:'2026-11-05'}],
  rows:[{id:'r1',name:'Расчёт',group:'office',values:{INIT:10}}],controlTotals:{}},
 operations:{version:1,openings:{RUB:100,USD:0,CARD:0,AVITO:0},nextSeq:4,
  suppliers:[{id:'anna',name:'Анна'}],invoices:[invoice('i0','TRACK-0')],
  payments:[],allocations:[],cash:[]}});

test('two devices adding different invoices, payments, cash and sales converge without duplicates',()=>{
 const original=base(),a=clone(original),b=clone(original),saved=JSON.stringify(original);
 a.operations.invoices.push(invoice('iA','TRACK-A'));
 a.operations.cash.push({id:'cash-A',kind:'income',currency:'RUB',amount:200,date:'2026-11-06'});
 a.operations.nextSeq=6;
 b.operations.invoices.push(invoice('iB','TRACK-B'));
 b.operations.payments.push(payment('pay-B'));
 b.operations.sales=[{id:'sale-B',date:'2026-11-06',item:'Пылесос',qty:1}];
 b.operations.nextSeq=7;
 const merged=mergeFinanceBackups(original,a,b);
 assert.deepEqual(merged.conflicts,[]);
 assert.deepEqual(new Set(merged.merged.operations.invoices.map(i=>i.id)),new Set(['i0','iA','iB']));
 assert.equal(merged.merged.operations.cash.length,1);
 assert.equal(merged.merged.operations.payments.length,1);
 assert.equal(merged.merged.operations.sales.length,1);
 assert.equal(merged.merged.operations.nextSeq,7);
 assert.equal(JSON.stringify(original),saved);
});

test('two devices editing different financial calculation cells and opening balances converge',()=>{
 const original=base(),a=clone(original),b=clone(original);
 a.proschet.rows[0].values.NOV=120;
 a.operations.openings.RUB=150;
 b.proschet.rows[0].values.DEC=250;
 b.operations.openings.USD=100;
 const result=mergeFinanceBackups(original,a,b);
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(result.merged.proschet.rows[0].values,{INIT:10,NOV:120,DEC:250});
 assert.equal(result.merged.operations.openings.RUB,150);
 assert.equal(result.merged.operations.openings.USD,100);
});

test('independent new periods, historical adjustment notes and audit events all remain available',()=>{
 const original=base(),a=clone(original),b=clone(original);
 a.proschet.snapshots.push({id:'NOV',label:'Ноябрь',date:'2026-11-05'});
 a.proschet.periodAdjustments={NOV:{income:500}};
 a.proschet.auditTrail=[{id:'audit-a',at:'2026-11-05T09:00:00Z',summary:'Изменена строка'}];
 b.proschet.snapshots.push({id:'DEC',label:'Декабрь',date:'2026-12-01'});
 b.proschet.periodAdjustments={DEC:{expense:100}};
 b.proschet.auditTrail=[{id:'audit-b',at:'2026-11-05T10:00:00Z',summary:'Новая запись'}];
 const result=mergeFinanceBackups(original,a,b);
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(new Set(result.merged.proschet.snapshots.map(s=>s.id)),new Set(['INIT','NOV','DEC']));
 assert.equal(result.merged.proschet.periodAdjustments.NOV.income,500);
 assert.equal(result.merged.proschet.periodAdjustments.DEC.expense,100);
 assert.equal(result.merged.proschet.auditTrail.length,2);
});

test('concurrent edits to the same invoice amount or same calculation cell remain blocked',()=>{
 const original=base(),a=clone(original),b=clone(original);
 a.operations.invoices[0].total=110;b.operations.invoices[0].total=120;
 assert.match(mergeFinanceBackups(original,a,b).conflicts.join(' '),/total/);
 a.operations.invoices[0].total=100;b.operations.invoices[0].total=100;
 a.proschet.rows[0].values.INIT=200;b.proschet.rows[0].values.INIT=300;
 assert.match(mergeFinanceBackups(original,a,b).conflicts.join(' '),/INIT/);
});

test('deleting a record while another device edits it is never silently merged',()=>{
 const original=base(),a=clone(original),b=clone(original);
 a.operations.invoices=[];b.operations.invoices[0].total=400;
 assert.equal(mergeFinanceBackups(original,a,b).merged,null);
});

test('two distinct payment allocations cannot exceed the available payment or invoice',()=>{
 const original=base();original.operations.payments.push(payment('pay-1'));
 const a=clone(original),b=clone(original);
 a.operations.allocations.push({id:'alloc-a',invoiceId:'i0',paymentId:'pay-1',amount:70});
 b.operations.allocations.push({id:'alloc-b',invoiceId:'i0',paymentId:'pay-1',amount:70});
 const result=mergeFinanceBackups(original,a,b);
 assert.equal(result.merged,null);
 assert.match(result.conflicts.join(' '),/Зачёты/);
});

test('new invoices with duplicate tracking numbers are stopped for manual review',()=>{
 const original=base(),a=clone(original),b=clone(original);
 a.operations.invoices.push(invoice('i1','SAME'));
 b.operations.invoices.push(invoice('i2','SAME'));
 const result=mergeFinanceBackups(original,a,b);
 assert.equal(result.merged,null);
 assert.match(result.conflicts.join(' '),/одинаковый номер/);
});

test('two independent sales cannot sell more units than the invoice contains',()=>{
 const original=base(),a=clone(original),b=clone(original);
 a.operations.sales=[{id:'sale-a',source:'i0:0',qty:1}];
 b.operations.sales=[{id:'sale-b',source:'i0:0',qty:1}];
 const result=mergeFinanceBackups(original,a,b);
 assert.equal(result.merged,null);
 assert.match(result.conflicts.join(' '),/Продажи превысили остаток/);
});

test('automatic finance sync reads its common ancestor and never uploads a conflicting overwrite',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/git\/blobs\/.*meta\.sha/);
 assert.match(html,/mergeFinanceBackups\(original,getSnapshot\(\),found\.data\)/);
 assert.match(html,/outcome\.conflicts\.length/);
 assert.match(html,/installSnapshot\(outcome\.merged,found,true,localHash/);
 assert.match(html,/setMeta\(found\.sha,found\.hash\)/);
 assert.match(html,/if\(automatic&&unsafeToRefresh\(\)\)/);
});
