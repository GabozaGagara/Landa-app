import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=html.indexOf('function supplierTotals(id){');
const b=html.indexOf('function invoicePaid(id){',a);
assert.ok(a>=0&&b>a,'Supplier balance function must exist');
const supplierTotalsSource=html.slice(a,b);
function makeModel(withOpening=true){
 const inv=[
  {id:'a',supplierId:'alina',total:2516,accrued:true,status:'delivered'},
  {id:'b',supplierId:'alina',total:2607,accrued:true,status:'delivered'},
  {id:'c',supplierId:'alina',total:4848,accrued:true,status:'delivered'},
  {id:'d',supplierId:'alina',total:1498,accrued:true,status:'delivered'},
  {id:'e',supplierId:'alina',total:1033,accrued:false,status:'created'},
 ];
 // Total invoices in this synthetic example: 11,469, only 11,469?
 return {
  invoices:withOpening?[...inv,{id:'opening',supplierId:'alina',isOpening:true,total:2116,status:'received'}]:inv,
  payments:[{id:'payment',supplierId:'alina',amount:18000}],
  reservedAdvances:[],allocations:[],
 };
}
function compute(ops){
 const run=new Function('ops',`
 const moneyCents=n=>Math.round(Number(n)*100),fromCents=n=>Math.round(n)/100;
 const invoiceAccrued=i=>i.isOpening||i.accrued===true;
 const invoiceAmount=i=>invoiceAccrued(i)?moneyCents(i.total):0;
 const reservedRemainingCents=r=>moneyCents(r.amount)-moneyCents(r.releasedAmount||0);
 const statusCode=i=>i.status;
 const shipmentTotalCents=i=>moneyCents(i.total);
 ${supplierTotalsSource}
 return supplierTotals('alina');
 `);
 return run(ops);
}
test('opening debt is charged exactly once even without product lines',()=>{
 const ops=makeModel(),balance=compute(ops),without=compute(makeModel(false));
 assert.equal(balance.openingDebt,2116);
 assert.equal(balance.ordinaryInvoices,without.total);
 assert.equal(without.balance-balance.balance,2116);
 assert.equal(balance.paid,18000);
 assert.equal(balance.balance,balance.paid-balance.ordinaryInvoices-balance.openingDebt);
});
test('allocating or unallocating opening debt does not double deduct it',()=>{
 const ops=makeModel();
 const baseline=compute(ops);
 ops.allocations=[{id:'alloc',invoiceId:'opening',paymentId:'payment',amount:2116}];
 const allocated=compute(ops);
 assert.equal(allocated.balance,baseline.balance);
 assert.equal(allocated.advance,baseline.advance-2116);
 assert.equal(allocated.open,baseline.open-2116);
});
test('reserved advances are independently deducted from available supplier balance',()=>{
 const ops=makeModel();
 ops.reservedAdvances=[{supplierId:'alina',amount:3000,releasedAmount:0}];
 const result=compute(ops);
 assert.equal(result.reserved,3000);
 assert.equal(result.balance,compute(makeModel()).balance-3000);
});
test('unaccrued incoming invoices are excluded from deduction',()=>{
 const ops=makeModel();
 const current=compute(ops);
 const pending=ops.invoices.find(i=>i.id==='e');
 pending.total=10000;
 assert.equal(compute(ops).balance,current.balance);
 pending.accrued=true;
 assert.equal(compute(ops).balance,current.balance-10000);
});
test('dashboard displays opening debt and line-by-line balance calculation',()=>{
 assert.match(html,/id="supplierBalanceBreakdown"/);
 assert.match(html,/Начальный долг · вычтен из баланса/);
 assert.match(html,/Начальный долг \(отдельно вычитается\)/);
 assert.match(html,/Начальный долг уменьшает баланс один раз при начислении/);
 assert.match(html,/ordinaryInvoices:fromCents\(ordinaryInvoiceCents\)/);
});
