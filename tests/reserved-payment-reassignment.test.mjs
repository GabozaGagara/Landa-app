import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=html.indexOf('function paymentReassignmentPlan(sourceId){');
const b=html.indexOf('function moveReservedPaymentAllocations(){',a);
assert.ok(a>=0&&b>a,'reassignment planner must exist in operational script');
const pure=html.slice(a,b);
const action=html.slice(b,html.indexOf('function reservePaymentOptions(){',b));

const model=()=>({
  suppliers:[{id:'anna'},{id:'alina'}],
  payments:[
   {id:'old',supplierId:'anna',amount:11420,date:'2026-10-28',note:'Начальный аванс'},
   {id:'tea',supplierId:'anna',amount:30100,date:'2026-10-29',note:'На чайники'},
   {id:'other',supplierId:'alina',amount:100000,date:'2026-10-25',note:'Другой поставщик'},
  ],
  invoices:[
   {id:'inv',supplierId:'anna',number:'TEST-4848',total:4848,accrued:true},
   {id:'inv2',supplierId:'anna',number:'TEST-2516',total:2516,accrued:true},
   {id:'inv3',supplierId:'anna',number:'TEST-2607',total:2607,accrued:true},
  ],
  allocations:[
   {id:'a1',paymentId:'old',invoiceId:'inv',amount:1253},
   {id:'a2',paymentId:'old',invoiceId:'inv2',amount:2516},
   {id:'a3',paymentId:'old',invoiceId:'inv3',amount:2607},
   {id:'a4',paymentId:'tea',invoiceId:'inv',amount:3595},
  ],
  reservedAdvances:[],
  cash:[{id:'cashtea',paymentId:'tea',currency:'USD',kind:'supplier',amount:-30100}],
});
function setup(data=model()){
 const run=new Function('initial',`
  let ops=initial,serial=0;
  const moneyCents=n=>Math.round(Number(n)*100),fromCents=n=>Math.round(n)/100;
  const paymentAllocated=id=>fromCents(ops.allocations.filter(x=>x.paymentId===id).reduce((s,x)=>s+moneyCents(x.amount),0));
  const paymentReservedCents=id=>(ops.reservedAdvances||[]).filter(x=>x.paymentId===id).reduce((s,x)=>s+moneyCents(x.amount)-moneyCents(x.releasedAmount||0),0);
  const paymentFree=p=>fromCents(Math.max(0,moneyCents(p.amount)-moneyCents(paymentAllocated(p.id))-paymentReservedCents(p.id)));
  const invoiceAccrued=i=>i.accrued===true;
  const sortAsc=(a,b)=>String(a.date).localeCompare(String(b.date));
  const opId=()=> 'newalloc-'+(++serial);
  const cashFmt=v=>String(v)+' $',dateText=v=>v;
  ${pure}
  return {plan:paymentReassignmentPlan,apply:applyPaymentReassignmentPlan,details:paymentReassignmentDetails,
          free:id=>paymentFree(ops.payments.find(p=>p.id===id)),getOps:()=>ops,setOps:x=>ops=x};
 `);
 return run(structuredClone(data));
}

test('tea payment free figure correctly subtracts earlier invoice allocations',()=>{
 const s=setup();
 assert.equal(s.free('tea'),26505);
 assert.equal(s.free('old'),5044);
 const plan=s.plan('tea');
 assert.equal(plan.possible,true);
 assert.equal(plan.allocatedCents,359500);
 assert.equal(plan.moves.length,1);
 assert.equal(plan.moves[0].toPaymentId,'old');
 assert.match(s.details(plan),/TEST-4848/);
});

test('moving the invoice allocation frees all tea money without changing cash or paid invoice',()=>{
 const s=setup(),before=structuredClone(s.getOps());
 const after=s.apply(s.plan('tea'));
 assert.equal(after.allocations.find(x=>x.id==='a4').paymentId,'old');
 assert.equal(after.allocations.filter(x=>x.invoiceId==='inv').reduce((sum,x)=>sum+x.amount,0),4848);
 assert.deepEqual(after.payments,before.payments);
 assert.deepEqual(after.cash,before.cash);
 assert.deepEqual(after.invoices,before.invoices);
 s.setOps(after);
 assert.equal(s.free('tea'),30100);
 assert.equal(s.free('old'),1449);
 // Reservation of 30 000 leaves 100 from the original transfer.
 after.reservedAdvances.push({id:'hold',supplierId:'anna',paymentId:'tea',amount:30000,releasedAmount:0,purpose:'Чайники'});
 assert.equal(s.free('tea'),100);
});

test('different supplier funds cannot finance a reassigned invoice payment',()=>{
 const d=model();d.payments[0].amount=6376;
 const s=setup(d),plan=s.plan('tea');
 assert.equal(plan.possible,false);
 assert.deepEqual(s.getOps(),d);
});

test('reassignment can split a large allocation across several valid payments',()=>{
 const d=model();
 d.payments[0].amount=7876; // 1500 free
 d.payments.push({id:'third',supplierId:'anna',amount:2500,date:'2026-10-30',note:'Other free payment'});
 const s=setup(d),plan=s.plan('tea');
 assert.equal(plan.possible,true);
 assert.equal(plan.moves.length,2);
 const out=s.apply(plan);
 assert.equal(out.allocations.filter(x=>x.invoiceId==='inv').reduce((sum,x)=>sum+x.amount,0),4848);
 assert.deepEqual(out.cash,d.cash);
 s.setOps(out);
 assert.equal(s.free('tea'),30100);
 assert.equal(s.free('old'),0);
 assert.equal(s.free('third'),405);
});

test('reassignment rejects changes to source allocations while confirmation is open',()=>{
 const s=setup(),before=s.plan('tea');
 s.getOps().allocations[3].amount=3000;
 assert.throws(()=>s.apply(before),/Зачёты изменились/);
});

test('reassignment UI requires explicit confirmation, never edits supplier cash or payments',()=>{
 assert.match(html,/id="reserveMoveAllocations"/);
 assert.match(action,/askConfirm\(/);
 assert.match(action,/JSON\.stringify\(ops\)!==expected/);
 assert.match(action,/if\(!saveOps\(\)\)/);
 assert.doesNotMatch(action,/ops\.cash\s*=|ops\.cash\.push\(|ops\.payments\s*=/);
});
