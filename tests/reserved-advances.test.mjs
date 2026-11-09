import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeFinanceBackups} from '../js/landa-finance-sync-core.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const core=readFileSync(new URL('../js/landa-finance-sync-core.mjs',import.meta.url),'utf8');

function slice(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a);
 assert.ok(a>=0&&b>a,'Missing finance function '+start);
 return html.slice(a,b);
}
const helpers=[
 slice('function supplierTotals(id)','function invoicePaid(id)'),
 slice('function paymentAllocated(id)','function applyAdvance(invoiceId)'),
].join('\n');
let counter=0;
const finance=new Function('ops',`
 const moneyCents=n=>Math.round(Number(n)*100);
 const fromCents=n=>Math.round(n)/100;
 const invoiceAmount=i=>i.accrued?moneyCents(i.total):0;
 const shipmentTotalCents=i=>moneyCents(i.total);
 const statusCode=i=>i.status||'created';
 const invoiceDue=i=>fromCents(Math.max(0,moneyCents(i.total)-(ops.allocations||[]).filter(a=>a.invoiceId===i.id).reduce((s,a)=>s+moneyCents(a.amount),0)));
 const opId=()=> 'allocated-test-' + ops.allocations.length;
 ${helpers}
 return {supplierTotals,paymentFree,paymentReservedCents,addAllocation};
`);

const draft=()=>({
 suppliers:[{id:'anna',name:'Анна'}],
 invoices:[{id:'inv1',supplierId:'anna',total:200,accrued:true,status:'delivered'}],
 payments:[{id:'pay1',supplierId:'anna',date:'2026-11-01',amount:1000}],
 allocations:[],
 reservedAdvances:[{id:'res1',paymentId:'pay1',supplierId:'anna',amount:300,releasedAmount:0,purpose:'Чайники',createdAt:'2026-11-09T10:00:00Z'}],
});
const cloud=()=>({
 app:'LANDA-suite',backupVersion:3,createdAt:'2026-11-09T10:00:00Z',
 proschet:{version:1,groups:[],rows:[],snapshots:[]},
 operations:{
  version:1,nextSeq:1,openings:{RUB:0,USD:0,CARD:0,AVITO:0},
  suppliers:[{id:'anna',name:'Анна'}],invoices:[],payments:[{id:'pay1',supplierId:'anna',date:'2026-11-01',amount:1000}],
  allocations:[],cash:[],reservedAdvances:[],auditTrail:[],
 }
});
const reserve=(id,amount)=>({id,paymentId:'pay1',supplierId:'anna',amount,releasedAmount:0,purpose:'Закупка',createdAt:'2026-11-09T10:00:00Z'});

test('supplier held funds are excluded from ordinary balance and visible separately',()=>{
 const ops=draft(),{supplierTotals,paymentFree}=finance(ops),t=supplierTotals('anna');
 assert.equal(t.paid,1000);
 assert.equal(t.total,200);
 assert.equal(t.reserved,300);
 assert.equal(t.balance,500);
 assert.equal(t.advance,700);
 assert.equal(paymentFree(ops.payments[0]),700);
});

test('allocated invoice money cannot consume a held advance',()=>{
 const ops=draft(),{addAllocation,paymentFree}=finance(ops);
 assert.equal(addAllocation('pay1','inv1',1000),200);
 assert.equal(paymentFree(ops.payments[0]),500);
 assert.equal(ops.allocations[0].amount,200);
 assert.equal(ops.reservedAdvances[0].amount,300);
});

test('releasing reserved funds restores ordinary advance without touching cash',()=>{
 const ops=draft(),before=JSON.stringify(ops.cash);
 ops.reservedAdvances[0].releasedAmount=300;
 const {supplierTotals,paymentFree}=finance(ops),totals=supplierTotals('anna');
 assert.equal(totals.reserved,0);
 assert.equal(totals.balance,800);
 assert.equal(totals.advance,1000);
 assert.equal(paymentFree(ops.payments[0]),1000);
 assert.equal(JSON.stringify(ops.cash),before);
});

test('two safe reservations on separate devices merge without duplication',()=>{
 const b=cloud(),l=structuredClone(b),r=structuredClone(b);
 l.operations.reservedAdvances.push(reserve('a',200));
 r.operations.reservedAdvances.push(reserve('b',300));
 const result=mergeFinanceBackups(b,l,r);
 assert.deepEqual(result.conflicts,[]);
 assert.equal(result.merged.operations.reservedAdvances.length,2);
});

test('two devices cannot reserve more than the actual payment',()=>{
 const b=cloud(),l=structuredClone(b),r=structuredClone(b);
 l.operations.reservedAdvances.push(reserve('a',700));
 r.operations.reservedAdvances.push(reserve('b',400));
 const result=mergeFinanceBackups(b,l,r);
 assert.equal(result.merged,null);
 assert.ok(result.conflicts.some(x=>x.includes('больше фактического перевода')));
});

test('reserved money and invoice allocations cannot exceed the same payment together',()=>{
 const b=cloud(),l=structuredClone(b),r=structuredClone(b);
 b.operations.invoices=[{id:'inv',supplierId:'anna',total:800,accrued:true}];
 l.operations.invoices=structuredClone(b.operations.invoices);
 r.operations.invoices=structuredClone(b.operations.invoices);
 l.operations.reservedAdvances.push(reserve('a',700));
 r.operations.allocations.push({id:'alloc',paymentId:'pay1',invoiceId:'inv',amount:400});
 const result=mergeFinanceBackups(b,l,r);
 assert.equal(result.merged,null);
 assert.ok(result.conflicts.length>0);
});

test('reserved UI derives its money from existing transfers and never creates new cash',()=>{
 assert.match(html,/Отложить из перевода/);
 const form=html.slice(html.indexOf("function reservePaymentOptions()"),html.indexOf("function openPayment()"));
 assert.match(form,/ops\.reservedAdvances\.push/);
 assert.doesNotMatch(form,/ops\.cash\.push|ops\.payments\.push/);
 assert.match(form,/cents>moneyCents\(paymentFree\(p\)\)/);
 assert.match(form,/function releaseReserve\(id\)/);
 assert.match(html,/id="supplierReservedAdvances"/);
 assert.match(html,/id="reserveDialog"/);
});

test('safe cross-device merge tracks reservation IDs',()=>{
 assert.match(core,/'operations\.reservedAdvances':'id'/);
});

test('new reservation merges safely with a legacy backup that has no reserve field',()=>{
 const b=cloud();delete b.operations.reservedAdvances;
 const l=structuredClone(b),r=structuredClone(b);
 l.operations.reservedAdvances=[reserve('new',250)];
 const result=mergeFinanceBackups(b,l,r);
 assert.deepEqual(result.conflicts,[]);
 assert.equal(result.merged.operations.reservedAdvances.length,1);
 assert.equal(result.merged.operations.reservedAdvances[0].amount,250);
});

test('reserve interactions stay inside the operational script to avoid startup errors',()=>{
 const blocks=html.split('<script>').slice(1).map(x=>x.split('</script>')[0]);
 const has=(term)=>blocks.findIndex(x=>x.includes(term));
 assert.ok(has('function openReserve(paymentId)')>=0);
 assert.equal(has('function openReserve(paymentId)'),has("else if(kind==='newReserve')openReserve()"));
 assert.equal(has('function releaseReserve(id)'),has('data-release-reserve'));
});

