import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function unchargeCdek(id){');
const end=html.indexOf("$('invoiceTable').addEventListener('change'",start);
assert.ok(start>=0&&end>start,'Invoice unaccrual action must exist');
const source=html.slice(start,end);
function scenario(saved=true){
 const original={
  invoices:[{id:'invoice-1',number:'10344376345',supplierId:'anna',total:5044,accrued:true,
    accruedAt:'2026-11-09T10:31:34Z',status:'delivered'},
   {id:'invoice-2',number:'next',supplierId:'anna',total:200,accrued:true,status:'delivered'}],
  payments:[{id:'pay-1',amount:11420,supplierId:'anna',note:'Начальный аванс'}],
  allocations:[{id:'allocation-1',paymentId:'pay-1',invoiceId:'invoice-1',amount:5044},
   {id:'allocation-2',paymentId:'pay-1',invoiceId:'invoice-2',amount:100}],
  cash:[{id:'cash-1',paymentId:'pay-1',currency:'USD',amount:-11420,kind:'supplier'}],
  reservedAdvances:[{id:'reserve-1',supplierId:'anna',paymentId:'pay-1',amount:200,releasedAmount:0,purpose:'Чайники'}],
  auditTrail:[],
 };
 let answer,question='',notice='',writeCount=0,refreshCount=0;
 const api=new Function('initial','hooks',`
  let ops=initial;
  const invoiceAccrued=i=>i.accrued===true;
  const moneyCents=n=>Math.round(Number(n)*100);
  const fromCents=n=>Math.round(n)/100;
  const cashFmt=n=>n.toLocaleString('ru-RU')+' $';
  const askConfirm=(text,yes)=>hooks.setConfirm(text,yes);
  const saveOps=()=>hooks.save();
  const renderOps=()=>hooks.render();
  const toast=msg=>hooks.toast(msg);
  const window={__landaReportError:msg=>hooks.toast(msg)};
  ${source}
  return {unchargeCdek,getOps:()=>ops};
 `)(structuredClone(original),{
  setConfirm:(text,yes)=>{question=text;answer=yes},
  save:()=>{writeCount++;return saved},
  render:()=>refreshCount++,
  toast:msg=>{notice=msg},
 });
 return {
  original,api,accept:()=>{if(!answer)throw Error('No confirmation requested');answer()},
  get question(){return question},get notice(){return notice},
  get writeCount(){return writeCount},get refreshCount(){return refreshCount},
 };
}
test('a paid invoice can be unaccrued with a single explicit confirmation',()=>{
 const s=scenario();
 s.api.unchargeCdek('invoice-1');
 assert.match(s.question,/5\s?044/);
 assert.match(s.question,/зачёт/i);
 assert.match(s.question,/Кассовые операции|кассовые операции/);
 assert.equal(s.writeCount,0);
 s.accept();
 assert.equal(s.writeCount,1);
 const next=s.api.getOps();
 assert.equal(next.invoices[0].accrued,false);
 assert.equal(Object.hasOwn(next.invoices[0],'accruedAt'),false);
 assert.equal(next.invoices[0].status,'delivered');
 assert.deepEqual(next.allocations,[s.original.allocations[1]]);
 assert.deepEqual(next.payments,s.original.payments);
 assert.deepEqual(next.cash,s.original.cash);
 assert.deepEqual(next.reservedAdvances,s.original.reservedAdvances);
 assert.deepEqual(next.invoices[1],s.original.invoices[1]);
});
test('canceling confirmation leaves all accounting data untouched',()=>{
 const s=scenario();
 s.api.unchargeCdek('invoice-1');
 assert.deepEqual(s.api.getOps(),s.original);
 assert.equal(s.writeCount,0);
});
test('failed browser save rolls back the whole reversal',()=>{
 const s=scenario(false);
 s.api.unchargeCdek('invoice-1');
 s.accept();
 assert.deepEqual(s.api.getOps(),s.original);
 assert.match(s.notice,/не подтвердил сохранение/);
});
test('stale invoice or allocation at confirmation time refuses rollback',()=>{
 const s=scenario();
 s.api.unchargeCdek('invoice-1');
 s.api.getOps().allocations[0].amount=4000;
 s.accept();
 assert.equal(s.writeCount,0);
 assert.match(s.notice,/изменились после открытия подтверждения/);
 assert.equal(s.api.getOps().invoices[0].accrued,true);
});
test('button clearly communicates linked payment release',()=>{
 assert.match(html,/Отменить начисление и зачёт/);
 assert.doesNotMatch(source,/ops\.cash\s*=|ops\.cash\.push\(|ops\.payments\s*=/);
});
