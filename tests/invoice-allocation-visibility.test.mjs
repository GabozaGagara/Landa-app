import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function reverseInvoiceAllocations(id){');
const end=html.indexOf('function applyAdvanceClick(id){',start);
assert.ok(start>=0&&end>start,'reverse allocation handler must be present');
const source=html.slice(start,end);
const fixture=()=>({
 invoices:[
  {id:'opening',supplierId:'alina',isOpening:true,number:'НАЧАЛЬНЫЙ-ДОЛГ',status:'received',total:2116,accrued:true},
  {id:'inv',supplierId:'alina',number:'10342418865',status:'delivered',total:1632,accrued:true},
  {id:'other',supplierId:'anna',number:'ANN-1',status:'delivered',total:100,accrued:true}
 ],
 payments:[{id:'p',supplierId:'alina',amount:18000,date:'2026-11-06'}, {id:'otherp',supplierId:'anna',amount:100,date:'2026-11-05'}],
 allocations:[
  {id:'a',paymentId:'p',invoiceId:'opening',amount:2116},
  {id:'b',paymentId:'p',invoiceId:'inv',amount:1632},
  {id:'c',paymentId:'otherp',invoiceId:'other',amount:100}
 ],
 reservedAdvances:[],cash:[{id:'cash',currency:'USD',amount:-18000,paymentId:'p'}]
});
function setup(canSave=true){
 const original=fixture();let confirm,askMessage='',notice='',saveCount=0;
 const fn=new Function('initial','hooks',`
 let ops=initial;
 const moneyCents=n=>Math.round(Number(n)*100),fromCents=n=>Math.round(n)/100;
 const cashFmt=n=>n.toLocaleString('ru-RU')+' $',dateText=x=>x;
 const askConfirm=(message,yes)=>hooks.ask(message,yes);
 const toast=message=>hooks.toast(message);
 const saveOps=()=>hooks.save();
 const renderOps=()=>{};
 const window={__landaReportError:message=>hooks.toast(message)};
 ${source}
 return {reverseInvoiceAllocations,getOps:()=>ops};
 `);
 const api=fn(structuredClone(original),{
  ask:(message,yes)=>{askMessage=message;confirm=yes},
  toast:message=>{notice=message},
  save:()=>{saveCount++;return canSave}
 });
 return {original,api,accept:()=>{assert.ok(confirm);confirm()},get message(){return askMessage},get notice(){return notice},get saved(){return saveCount}};
}
test('initial debt can have its payment allocation reversed without removing the debt',()=>{
 const t=setup();
 t.api.reverseInvoiceAllocations('opening');
 assert.match(t.message,/2\s?116/);
 assert.match(t.message,/начального долга/);
 assert.equal(t.saved,0);
 t.accept();
 const out=t.api.getOps();
 assert.ok(out.invoices.some(i=>i.id==='opening'&&i.total===2116));
 assert.equal(out.allocations.some(a=>a.invoiceId==='opening'),false);
 assert.equal(out.allocations.length,2);
 assert.deepEqual(out.cash,t.original.cash);
 assert.deepEqual(out.payments,t.original.payments);
 assert.deepEqual(out.reservedAdvances,t.original.reservedAdvances);
});
test('reversal increases free advance but does not change supplier net balance',()=>{
 const t=setup(),balance=o=>o.payments.filter(p=>p.supplierId==='alina').reduce((s,p)=>s+p.amount,0)-o.invoices.filter(i=>i.supplierId==='alina'&&i.accrued).reduce((s,i)=>s+i.total,0);
 const free=o=>o.payments.find(p=>p.id==='p').amount-o.allocations.filter(a=>a.paymentId==='p').reduce((s,a)=>s+a.amount,0);
 const net=balance(t.original),wasFree=free(t.original);
 t.api.reverseInvoiceAllocations('opening');t.accept();
 assert.equal(balance(t.api.getOps()),net);
 assert.equal(free(t.api.getOps())-wasFree,2116);
});
test('canceling the confirmation does not touch any data',()=>{
 const t=setup();t.api.reverseInvoiceAllocations('opening');
 assert.deepEqual(t.api.getOps(),t.original);assert.equal(t.saved,0);
});
test('a stale allocation at confirmation is never removed',()=>{
 const t=setup();t.api.reverseInvoiceAllocations('opening');t.api.getOps().allocations[0].amount=10;t.accept();
 assert.equal(t.saved,0);assert.equal(t.api.getOps().allocations[0].amount,10);
 assert.match(t.notice,/изменились/);
});
test('a failed local save rolls back all changes',()=>{
 const t=setup(false);t.api.reverseInvoiceAllocations('opening');t.accept();
 assert.deepEqual(t.api.getOps(),t.original);
 assert.match(t.notice,/не подтверждено/);
});
test('supplier invoice table shows payment sources, removal action, and accurate opening debt note',()=>{
 assert.match(html,/function invoiceAllocationMarkup\(id\)/);
 assert.match(html,/Источники зачёта/);
 assert.match(html,/data-reverse-allocation/);
 assert.match(html,/Исторический начальный долг · товары не требуются/);
 assert.match(html,/Исторический начальный долг:/);
 assert.match(html,/function reverseInvoiceAllocations\(id\)/);
 assert.doesNotMatch(source,/ops\.payments\s*=|ops\.cash\s*=/);
});
