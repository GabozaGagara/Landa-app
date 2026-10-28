import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {supplierOverview} from '../cloudflare/supplier-view.mjs';
import worker,{__test as bridge} from '../cloudflare/worker.mjs';

const ORIGIN='https://gabozagagara.github.io';
const codes={anna:'a'.repeat(32),alina:'b'.repeat(32),anatoly:'c'.repeat(32)};
const env={SUPPLIER_CODES:JSON.stringify(codes),GH_TOKEN:'test-only-token'};
const base=()=>({
 app:'LANDA-suite',backupVersion:3,proschet:{version:1,rows:[],groups:[],snapshots:[]},
 operations:{version:1,openings:{RUB:0,USD:0,CARD:0,AVITO:0},nextSeq:3,
  suppliers:[{id:'anna',name:'Анна'},{id:'alina',name:'Алина'},{id:'anatoly',name:'Анатолий'}],
  invoices:[
   {id:'a1',supplierId:'anna',number:'10000000001',tracking:'10000000001',date:'2026-10-28',total:100,goodsCost:100,accrued:true,status:'delivered',items:[{name:'Товар A',qty:2,price:50}]},
   {id:'a2',supplierId:'anna',number:'10000000002',tracking:'10000000002',date:'2026-10-29',total:20,goodsCost:20,accrued:false,status:'created',items:[{name:'Товар B',qty:1,price:20}]},
   {id:'b1',supplierId:'alina',number:'20000000001',tracking:'20000000001',date:'2026-10-28',total:33,goodsCost:33,accrued:true,status:'delivered',items:[{name:'SECRET_OTHER_SUPPLIER',qty:1,price:33}]}],
  payments:[{id:'p1',supplierId:'anna',date:'2026-10-28',amount:90},{id:'p2',supplierId:'alina',date:'2026-10-28',amount:11}],
  allocations:[{id:'al1',paymentId:'p1',invoiceId:'a1',amount:70}],
  cash:[{id:'cash-secret',currency:'RUB',amount:999999,kind:'income'}],
  auditTrail:[{id:'audit-secret',summary:'SECRET_PRIVATE_AUDIT',at:'2026-10-28T12:00:00Z'}]
 }});
const post=(pathname,body,origin=ORIGIN)=>new Request('https://landa-app.example.test'+pathname,{
 method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)
});

// All tests use synthetic fixtures. Never check real private financial records into this repository.
test('supplier summary uses the same accrued-only cash formula as LANDA',()=>{
 const d=supplierOverview(base(),'anna',1);
 assert.equal(d.supplier.id,'anna');
 assert.deepEqual(d.summary,{balance:-10,paid:90,accrued:100,allocated:70,open:30,advance:20,pendingAmount:20,pendingCount:1,count:2});
 assert.equal(d.invoices.length,2);
 assert.equal(d.invoices[0].number,'10000000002');
 assert.equal(d.invoices[0].due,0); // Not accrued: no supplier debt yet
});

test('supplier overview never leaks other supplier or raw financial data',()=>{
 const response=JSON.stringify(supplierOverview(base(),'anna',1));
 for(const marker of ['SECRET_OTHER_SUPPLIER','SECRET_PRIVATE_AUDIT','cash-secret','20000000001','999999'])
  assert.equal(response.includes(marker),false,'Leaked marker '+marker);
 const alina=supplierOverview(base(),'alina',1);
 assert.equal(alina.summary.balance,-22);
 assert.equal(alina.invoices.length,1);
});

test('pagination and invalid supplier/page checks',()=>{
 const d=base();for(let k=0;k<35;k++)d.operations.invoices.push({id:'extra'+k,supplierId:'anna',number:'T'+k,tracking:'Z'+k,date:'2026-10-28',total:1,accrued:false});
 const page1=supplierOverview(d,'anna',1),page2=supplierOverview(d,'anna',2);
 assert.equal(page1.invoices.length,30);
 assert.equal(page2.invoices.length,7);
 assert.equal(page2.pagination.pages,2);
 assert.throws(()=>supplierOverview(d,'unknown',1));
 assert.throws(()=>supplierOverview(d,'anna',0));
});

test('worker refuses wrong code and wrong origin before any database read',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('GitHub must not be contacted')};
 try{
  const wrong=await worker.fetch(post('/supplier-overview',{supplierId:'anna',code:'x'.repeat(32)}),env);
  assert.equal(wrong.status,403);
  const crossOrigin=await worker.fetch(post('/supplier-overview',{supplierId:'anna',code:codes.anna},'https://attacker.example'),env);
  assert.equal(crossOrigin.status,403);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original}
});

test('authorized overview reads private backup but returns only personal projection',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;assert.match(url,/api.github.com\/repos\/GabozaGagara\/Landa-financenot/);
  assert.equal(options.method,'GET');
  return new Response(JSON.stringify({sha:'fake-sha',content:Buffer.from(JSON.stringify(base()),'utf8').toString('base64')}),{status:200});
 };
 try{
  const response=await worker.fetch(post('/supplier-overview',{supplierId:'anna',code:codes.anna}),env);
  assert.equal(response.status,200);
  const json=await response.json();
  assert.equal(json.summary.balance,-10);
  assert.equal(json.supplier.id,'anna');
  assert.equal(json.invoices.length,2);
  assert.equal('proschet' in json,false);
  assert.equal('operations' in json,false);
  assert.equal(calls,1);
 }finally{globalThis.fetch=original}
});

const incoming=(supplierId='anna',tracking='10339544154')=>({
 app:'LANDA-supplier-invoice',schemaVersion:1,supplierId,origin:'Брест',destination:'Москва',tracking,date:'2026-10-28',
 items:[{name:'Тестовый товар',qty:2,price:10.25}],deliveryCost:5,note:'Тест без реальных данных'
});

test('invoice normalization requires Brest and correct totals',()=>{
 const n=bridge.normalizeInvoice(incoming());
 assert.equal(n.goodsCost,20.5);
 assert.equal(n.deliveryCost,5);
 assert.equal(n.tracking,'10339544154');
 assert.throws(()=>bridge.normalizeInvoice({...incoming(),origin:'Минск'}));
 assert.throws(()=>bridge.normalizeInvoice({...incoming(),items:[]}));
});

test('supplier submit is unaccrued, review-pending, auditable and deduplicated',async()=>{
 let saved=base(),sha='old-sha';
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET')return new Response(JSON.stringify({sha,content:Buffer.from(JSON.stringify(saved),'utf8').toString('base64')}),{status:200});
  assert.equal(options.method,'PUT');
  const payload=JSON.parse(options.body);
  assert.equal(payload.sha,sha);
  saved=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));
  sha='new-sha';
  return new Response(JSON.stringify({content:{sha}}),{status:200});
 };
 try{
  const first=await worker.fetch(post('/submit',{invoice:incoming(),code:codes.anna}),env);
  assert.equal(first.status,201);
  const added=saved.operations.invoices.find(i=>i.tracking==='10339544154');
  assert.equal(added.accrued,false);
  assert.equal(added.reviewStatus,'pending');
  assert.equal(added.status,'created');
  assert.equal(added.total,20.5);
  assert.equal(saved.operations.cash.length,1);
  assert.ok(saved.operations.auditTrail.some(e=>e.recordId===added.id&&e.source==='supplier:anna'));
  const duplicate=await worker.fetch(post('/submit',{invoice:incoming(),code:codes.anna}),env);
  assert.equal(duplicate.status,409);
  assert.equal(saved.operations.invoices.filter(i=>i.tracking==='10339544154').length,1);
 }finally{globalThis.fetch=original}
});

test('public HTML and JavaScript remain parseable and include control modules',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../supplier.html',import.meta.url),'utf8');
 for(const page of [html,portal]){
  assert.match(page,/<\/html>/);
  for(const match of page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
   if(/type=["']application\/json["']/.test(match[1])||!match[2].trim())continue;
   assert.doesNotThrow(()=>new Function(match[2]));
  }
 }
 assert.match(html,/js\/landa-control-center\.js/);
 assert.match(html,/js\/landa-local-backups\.js/);
 for(const p of ['landa-control-center.js','landa-local-backups.js']){
  const js=readFileSync(new URL('../js/'+p,import.meta.url),'utf8');
  assert.doesNotThrow(()=>new Function(js));
 }
});

test('calendar validation rejects impossible dates, accepts leap day',()=>{
 assert.equal(bridge.normalizeInvoice({...incoming(),date:'2028-02-29'}).date,'2028-02-29');
 for(const date of ['2026-02-29','2026-02-30','2026-04-31','2026-13-01'])
  assert.throws(()=>bridge.normalizeInvoice({...incoming(),date}),date);
});

test('GitHub SHA conflicts retry with fresh state and preserve concurrent invoices',async()=>{
 const original=globalThis.fetch;
 let reads=0,writes=0,saved=null;
 const concurrent=base();
 concurrent.operations.invoices.push({id:'concurrent',supplierId:'alina',tracking:'30000000000',total:12,accrued:false});
 globalThis.fetch=async(_url,options)=>{
  if(options.method==='GET'){
   reads++;
   const data=reads===1?base():concurrent;
   return new Response(JSON.stringify({sha:'version-'+reads,content:Buffer.from(JSON.stringify(data)).toString('base64')}),{status:200});
  }
  writes++;
  const payload=JSON.parse(options.body);
  assert.equal(payload.sha,'version-'+writes);
  if(writes===1)return new Response(JSON.stringify({message:'conflict'}),{status:409});
  saved=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));
  return new Response(JSON.stringify({content:{sha:'written'}}),{status:200});
 };
 try{
  const result=await worker.fetch(post('/submit',{invoice:incoming(),code:codes.anna}),env);
  assert.equal(result.status,201);
  assert.equal(reads,2);
  assert.equal(writes,2);
  assert.ok(saved.operations.invoices.some(i=>i.id==='concurrent'));
  assert.ok(saved.operations.invoices.some(i=>i.tracking==='10339544154'));
 }finally{globalThis.fetch=original}
});

test('repeated SHA conflicts fail safely, without reporting a successful write',async()=>{
 const original=globalThis.fetch;let reads=0,writes=0;
 globalThis.fetch=async(_url,options)=>{
  if(options.method==='GET'){
   reads++;
   return new Response(JSON.stringify({sha:'version-'+reads,content:Buffer.from(JSON.stringify(base())).toString('base64')}),{status:200});
  }
  writes++;
  return new Response(JSON.stringify({message:'conflict'}),{status:409});
 };
 try{
  const result=await worker.fetch(post('/submit',{invoice:incoming(),code:codes.anna}),env);
  assert.equal(result.status,409);
  assert.equal(reads,4);
  assert.equal(writes,4);
  assert.equal((await result.json()).created,undefined);
 }finally{globalThis.fetch=original}
});
