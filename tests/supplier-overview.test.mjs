import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function supplierOverviewData(){');
const end=html.indexOf('function renderSupplierOverview(){',start);
assert.ok(start>=0&&end>start);
const source=html.slice(start,end);
const model={
 suppliers:[{id:'a',name:'A'},{id:'b',name:'B'}],
 invoices:[
  {id:'1',supplierId:'a',status:'delivered',total:1000,accrued:true},
  {id:'2',supplierId:'a',status:'received',total:200,accrued:false},
  {id:'3',supplierId:'a',status:'transit',total:300,accrued:false,deliveryCost:20},
  {id:'4',supplierId:'b',status:'ready',total:500,accrued:false},
  {id:'5',supplierId:'b',status:'created',total:700,accrued:false,deliveryMissing:true},
  {id:'6',supplierId:'a',status:'received',total:100,isOpening:true},
 ],
};
const balances={a:{balance:-800,reserved:0,open:900},b:{balance:5000,reserved:300,open:0}};
const evaluate=new Function('ops','balances',`
 const moneyCents=x=>Math.round(x*100);
 const supplierTotals=id=>balances[id];
 const statusCode=i=>i.status==='received'?'delivered':['created','ready','transit','delivered'].includes(i.status)?i.status:'created';
 const invoiceAccrued=i=>i.isOpening||i.accrued===true;
 const shipmentTotalCents=i=>moneyCents(i.total+(i.includeDelivery?0:i.deliveryCost||0));
 ${source}
 return supplierOverviewData();
`);
test('total debt does not offset different supplier credits',()=>{
 const {totals}=evaluate(model,balances);
 assert.equal(totals.debtCents,80000);
 assert.equal(totals.creditCents,500000);
 assert.equal(totals.heldCents,30000);
});
test('shipment status totals include delivery and exclude historic opening debt',()=>{
 const {totals:{stages}}=evaluate(model,balances);
 assert.equal(stages.delivered.count,2);
 assert.equal(stages.delivered.cents,120000);
 assert.equal(stages.delivered.unaccruedCents,20000);
 assert.equal(stages.transit.cents,32000);
 assert.equal(stages.ready.cents,50000);
 assert.equal(stages.created.cents,70000);
 assert.equal(stages.created.missingDelivery,1);
});
test('unaccrued shipments do not increase current payable balance',()=>{
 const before=JSON.stringify(model);
 const first=evaluate(model,balances);
 const extra=structuredClone(model);
 extra.invoices.push({id:'7',supplierId:'a',status:'ready',total:9000,accrued:false});
 const next=evaluate(extra,balances);
 assert.equal(next.totals.debtCents,first.totals.debtCents);
 assert.equal(next.totals.stages.ready.cents-first.totals.stages.ready.cents,900000);
 assert.equal(JSON.stringify(model),before);
});
test('per-supplier stages sum to the overview total',()=>{
 const {rows,totals}=evaluate(model,balances);
 for(const key of ['delivered','created','transit','ready']){
  assert.equal(rows.reduce((n,r)=>n+r.stages[key].cents,0),totals.stages[key].cents);
  assert.equal(rows.reduce((n,r)=>n+r.stages[key].count,0),totals.stages[key].count);
 }
});
test('all overview lists and summary render inside supplier section',()=>{
 for(const id of ['supplierOverviewKpis','supplierOverviewTable','supplierOverviewNote','supplierStageDelivered','supplierStageTransit','supplierStageReady','supplierStageCreated'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/function renderSuppliers\(\)\{renderSupplierOverview\(\)/);
});
