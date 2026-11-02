import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySupplierEdit,supplierEditable,supplierEditVersion} from '../cloudflare/supplier-edit.mjs';
import {supplierOverview} from '../cloudflare/supplier-view.mjs';
import worker,{__test as bridge} from '../cloudflare/worker.mjs';

const ORIGIN='https://gabozagagara.github.io';
const codes={anna:'a'.repeat(32),alina:'b'.repeat(32),anatoly:'c'.repeat(32)};
const env={GH_TOKEN:'test-token',SUPPLIER_CODES:JSON.stringify(codes)};
const req=(url,body,origin=ORIGIN)=>new Request('https://landa-app.test'+url,{
 method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const incoming=(supplierId='anna',tracking='90000000003')=>({
 app:'LANDA-supplier-invoice',schemaVersion:1,supplierId,origin:'Брест',destination:'Москва',tracking,
 date:'2026-10-30',sender:'Тестовый отправитель',items:[{name:'Пылесос',qty:2,price:100,sku:'SKU-1'}],
 deliveryCost:10,note:'Пробный комментарий'
});
const fixture=()=>{
 const i=bridge.normalizeInvoice(incoming());
 const invoice={id:'supplier-demo',seq:2,supplierId:'anna',submittedAt:'2026-10-30T09:00:00Z',
  date:i.date,number:i.tracking,tracking:i.tracking,goodsCost:i.goodsCost,deliveryCost:i.deliveryCost,
  total:210,deliveryMissing:false,includeDelivery:true,status:'transit',
  reviewStatus:'approved',accrued:false,items:i.items,sender:i.sender,route:'Брест → Москва',supplierNote:i.note,
  note:'Поставщик отправил тестовую накладную'};
 return {app:'LANDA-suite',backupVersion:3,proschet:{version:1,groups:[],rows:[],snapshots:[]},
  operations:{version:1,suppliers:[{id:'anna'},{id:'alina'}],invoices:[invoice,
   {id:'other',supplierId:'alina',number:'other-number',tracking:'other-number',total:300,accrued:false}],
   payments:[{id:'pay',supplierId:'anna',amount:150}],allocations:[],cash:[{id:'cash',amount:999}],
   auditTrail:[],nextSeq:3}};
};
const update=(tracking='90000000003')=>bridge.normalizeInvoice({...incoming('anna',tracking),
 items:[{name:'Пылесос',qty:3,price:100,sku:'SKU-1'},{name:'Деталь',qty:1,price:25}],
 deliveryCost:15,note:'Исправил количество и добавил деталь'});
const time='2026-11-02T12:00:00Z';
const call=(b,changes=update(),revision=0,version=supplierEditVersion(b.operations.invoices[0]))=>
 applySupplierEdit(b.operations,'anna','supplier-demo',revision,version,changes,time,'evt-1');
const errorCode=(fn,n)=>assert.throws(fn,e=>e.code===n);

test('supplier can correct own undelivered, uncharged invoice; prices and shipping update without payment changes',()=>{
 const b=fixture(),saved=structuredClone(b.operations.payments),cash=structuredClone(b.operations.cash);
 const before=b.operations.invoices[0],submission=before.submittedAt;
 const result=call(b);
 assert.equal(result.updated,true);assert.equal(result.revision,1);
 const after=b.operations.invoices[0];
 assert.equal(after.id,'supplier-demo');assert.equal(after.status,'transit');
 assert.equal(after.submittedAt,submission);
 assert.equal(after.goodsCost,325);assert.equal(after.deliveryCost,15);assert.equal(after.total,340);
 assert.equal(after.reviewStatus,'pending');assert.equal(after.supplierEditedBy,'anna');
 assert.equal(after.supplierEditHistory.length,1);
 assert.ok(after.supplierEditHistory[0].changes.some(c=>c.field==='items'&&/Пылесос/.test(c.before)&&/Деталь/.test(c.after)));
 assert.ok(after.supplierEditHistory[0].changes.some(c=>c.field==='deliveryCost'&&c.before==='10'&&c.after==='15'));
 assert.deepEqual(b.operations.payments,saved);assert.deepEqual(b.operations.cash,cash);
 assert.equal(b.operations.auditTrail.at(-1).type,'supplier_edit');
 assert.equal(b.operations.invoices[1].supplierId,'alina');
 const view=supplierOverview(b,'anna').invoices[0];
 assert.equal(view.editable,true);assert.equal(view.editRevision,1);assert.equal(view.editedBy,'Поставщик');
 assert.equal(view.reviewStatus,'pending');assert.equal(view.id,'supplier-demo');
 assert.equal(view.editVersion,result.editVersion);
 assert.equal('auditTrail' in view,false);
});
test('stale revision or owner changes reject supplier edit rather than overwrite',()=>{
 const b=fixture(),version=supplierEditVersion(b.operations.invoices[0]);
 call(b);
 errorCode(()=>applySupplierEdit(b.operations,'anna','supplier-demo',0,version,update(),time,'evt-2'),409);
 const newVersion=supplierEditVersion(b.operations.invoices[0]);
 b.operations.invoices[0].items[0].qty=5; // Owner changed underlying invoice since list loaded.
 errorCode(()=>applySupplierEdit(b.operations,'anna','supplier-demo',1,newVersion,update(),time,'evt-3'),409);
 assert.equal(b.operations.invoices[0].items[0].qty,5);
});
test('server rejects delivered / received / accrued / allocated invoices and leaves private backup intact',()=>{
 for(const state of ['delivered','received','accrued','allocated']){
  const b=fixture(),i=b.operations.invoices[0];
  if(state==='delivered'||state==='received')i.status=state;
  if(state==='accrued')i.accrued=true;
  if(state==='allocated')b.operations.allocations.push({invoiceId:i.id,paymentId:'pay',amount:2});
  const before=JSON.stringify(b.operations);
  assert.equal(supplierEditable(i,'anna',b.operations.allocations),false,state);
  errorCode(()=>call(b),403);
  assert.equal(JSON.stringify(b.operations),before,state);
 }
});
test('server rejects attempts on other supplier, owner-made invoice, duplicate tracking and invalid revision',()=>{
 const b=fixture();
 errorCode(()=>applySupplierEdit(b.operations,'alina','supplier-demo',0,'x',update(),time,'event'),404);
 b.operations.invoices[0].submittedAt=null;
 errorCode(()=>call(b),403);
 b.operations.invoices[0].submittedAt='2026-10-30T09:00:00Z';
 errorCode(()=>call(b,update('other-number')),409);
 errorCode(()=>call(b,update(),5),409);
});
test('supplier overview exposes only their editable entries, never another supplier details or audit history',()=>{
 const b=fixture(),view=supplierOverview(b,'anna');
 assert.equal(view.invoices.length,1);
 assert.equal(view.invoices[0].editable,true);
 assert.ok(typeof view.invoices[0].editVersion==='string');
 const raw=JSON.stringify(view);
 assert.equal(raw.includes('other-number'),false);
 assert.equal(raw.includes('auditTrail'),false);
 b.operations.invoices[0].status='delivered';
 assert.equal(supplierOverview(b,'anna').invoices[0].editable,false);
});
test('invalid code and cross-origin request are denied before reading finance',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Must not fetch private database')};
 try{
  const input={invoice:incoming(),invoiceId:'supplier-demo',revision:0,editVersion:'fake',code:codes.anna};
  assert.equal((await worker.fetch(req('/supplier-edit',{...input,code:'wrong'}),env)).status,403);
  assert.equal((await worker.fetch(req('/supplier-edit',input,'https://evil.example'),env)).status,403);
  assert.equal(calls,0);
 }finally{globalThis.fetch=previous}
});
test('worker editing commits through GitHub CAS and preserves unrelated financial data',async()=>{
 const previous=globalThis.fetch;
 let saved=fixture(),reads=0,writes=0;
 globalThis.fetch=async(_url,opts)=>{
  if(opts.method==='GET'){
   reads++;return new Response(JSON.stringify({sha:'sha-1',content:Buffer.from(JSON.stringify(saved)).toString('base64')}),{status:200});
  }
  writes++;const payload=JSON.parse(opts.body);assert.equal(payload.sha,'sha-1');
  saved=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));
  return new Response(JSON.stringify({content:{sha:'sha-2'}}),{status:200});
 };
 try{
  const input={invoice:{...incoming(),items:[{name:'Пылесос',qty:3,price:100}]},invoiceId:'supplier-demo',revision:0,
   editVersion:supplierEditVersion(saved.operations.invoices[0]),code:codes.anna};
  const response=await worker.fetch(req('/supplier-edit',input),env),data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.updated,true);
  assert.equal(reads,1);assert.equal(writes,1);
  assert.equal(saved.operations.invoices[0].reviewStatus,'pending');
  assert.equal(saved.operations.invoices[0].supplierEditRevision,1);
  assert.equal(saved.operations.cash[0].amount,999);
  assert.equal(saved.operations.invoices[1].supplierId,'alina');
 }finally{globalThis.fetch=previous}
});
test('a concurrent delivered status during GitHub conflict blocks retry',async()=>{
 const previous=globalThis.fetch;let reads=0,writes=0;
 const b=fixture(),version=supplierEditVersion(b.operations.invoices[0]);
 globalThis.fetch=async(_url,opts)=>{
  if(opts.method==='GET'){
   reads++;const latest=structuredClone(b);
   if(reads===2)latest.operations.invoices[0].status='delivered';
   return new Response(JSON.stringify({sha:'sha-'+reads,content:Buffer.from(JSON.stringify(latest)).toString('base64')}),{status:200});
  }
  writes++;return new Response(JSON.stringify({message:'conflict'}),{status:409});
 };
 try{
  const response=await worker.fetch(req('/supplier-edit',{invoice:incoming(),invoiceId:'supplier-demo',revision:0,editVersion:version,code:codes.anna}),env);
  assert.equal(response.status,403);assert.equal(reads,2);assert.equal(writes,1);
 }finally{globalThis.fetch=previous}
});
test('owner and supplier UI expose clear review trail but no new owner restrictions',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../supplier.html',import.meta.url),'utf8');
 const center=readFileSync(new URL('../js/landa-control-center.js',import.meta.url),'utf8');
 assert.match(html,/supplierEditMarkup/);assert.match(html,/История исправлений/);
 assert.match(portal,/data-edit-supplier-invoice/);assert.match(portal,/supplier-edit/);
 assert.match(center,/ИЗМЕНЕНА ПОСТАВЩИКОМ/);
 assert.match(html,/data-edit-invoice/); // Owner can still edit delivered records.
});
