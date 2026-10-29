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

const incoming=(supplierId='anna',tracking='90000000003')=>({
 app:'LANDA-supplier-invoice',schemaVersion:1,supplierId,origin:'Брест',destination:'Москва',tracking,date:'2026-10-28',
 items:[{name:'Тестовый товар',qty:2,price:10.25}],deliveryCost:5,note:'Тест без реальных данных'
});

test('invoice normalization requires Brest and correct totals',()=>{
 const n=bridge.normalizeInvoice(incoming());
 assert.equal(n.goodsCost,20.5);
 assert.equal(n.deliveryCost,5);
 assert.equal(n.tracking,'90000000003');
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
  const added=saved.operations.invoices.find(i=>i.tracking==='90000000003');
  assert.equal(added.accrued,false);
  assert.equal(added.reviewStatus,'pending');
  assert.equal(added.status,'created');
  assert.equal(added.total,20.5);
  assert.equal(saved.operations.cash.length,1);
  assert.ok(saved.operations.auditTrail.some(e=>e.recordId===added.id&&e.source==='supplier:anna'));
  const duplicate=await worker.fetch(post('/submit',{invoice:incoming(),code:codes.anna}),env);
  assert.equal(duplicate.status,409);
  assert.equal(saved.operations.invoices.filter(i=>i.tracking==='90000000003').length,1);
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
 assert.match(html,/js\/landa-receiving-ui\.mjs/);
 assert.match(html,/js\/landa-moysklad-ui\.mjs/);
 assert.match(portal,/id="newInvoiceFromList"/);
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
  assert.ok(saved.operations.invoices.some(i=>i.tracking==='90000000003'));
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

import {collectShipmentRows,compareCount,aggregateProducts,receiptCSV} from '../js/landa-receiving-core.mjs';

test('shipment reconciliation reads all items but can limit to supplier portal submissions',()=>{
 const invoices=[
  {id:'v1',supplierId:'anna',number:'TEST-1',tracking:'TRACK-1',date:'2026-10-20',submittedAt:'2026-10-20T00:00:00Z',
   items:[{name:'Dyson X',sku:'DX',qty:2,price:20},{name:'Dyson Y',sku:'DY',qty:1,price:30}]},
  {id:'v2',supplierId:'alina',number:'TEST-2',date:'2026-10-21',items:[{name:'Karcher',sku:'K',qty:3,price:50}]},
  {id:'opening',isOpening:true,supplierId:'anna',items:[{name:'Opening',qty:100}]}
 ];
 const unchanged=JSON.stringify(invoices);
 const all=collectShipmentRows(invoices);
 assert.equal(all.length,3);
 assert.equal(collectShipmentRows(invoices,{onlyPortal:true}).length,2);
 assert.equal(collectShipmentRows(invoices,{supplier:'anna',search:'DX'}).length,1);
 assert.equal(collectShipmentRows(invoices,{supplier:'alina'}).length,1);
 assert.equal(JSON.stringify(invoices),unchanged,'Reading shipments must not mutate financial invoices');
});
test('manual comparison distinguishes pending, matching, shortages and extra pieces',()=>{
 const row={qty:3};
 assert.deepEqual(compareCount(row,undefined),{state:'pending',received:null,delta:null});
 assert.deepEqual(compareCount(row,{received:''}),{state:'pending',received:null,delta:null});
 assert.deepEqual(compareCount(row,{received:3}),{state:'matched',received:3,delta:0});
 assert.deepEqual(compareCount(row,{received:2}),{state:'difference',received:2,delta:-1});
 assert.deepEqual(compareCount(row,{received:4}),{state:'difference',received:4,delta:1});
 assert.equal(compareCount(row,{received:-1}).state,'invalid');
});
test('supplier-specific product aggregation never treats an unchecked line as received',()=>{
 const invoices=[
  {id:'1',supplierId:'anna',number:'INV-A',items:[{name:'Dyson',sku:'D',qty:2},{name:'Dyson',sku:'D',qty:1}]},
  {id:'2',supplierId:'alina',number:'INV-B',items:[{name:'Dyson',sku:'D',qty:5}]}
 ];
 const rows=collectShipmentRows(invoices),records={};
 const anna=rows.filter(x=>x.supplierId==='anna');
 records[anna[0].key]={received:2};
 let ag=aggregateProducts(rows,records);
 const a=ag.find(x=>x.supplierId==='anna'),b=ag.find(x=>x.supplierId==='alina');
 assert.equal(a.expected,3);assert.equal(a.received,null);assert.equal(a.done,1);
 assert.equal(b.expected,5);assert.equal(b.received,null);
 records[anna[1].key]={received:1};
 ag=aggregateProducts(rows,records);
 assert.equal(ag.find(x=>x.supplierId==='anna').received,3);
 assert.equal(ag.find(x=>x.supplierId==='anna').delta,0);
});
test('reconciliation CSV retains negative numeric differences and guards formula-like strings',()=>{
 const invoices=[{id:'x1',supplierId:'anna',number:'TEST-CSV',items:[{name:'=HYPERLINK("bad")',sku:'SKU',qty:3}]}];
 const rows=collectShipmentRows(invoices),count={};
 count[rows[0].key]={received:1,note:'+unsafe formula'};
 const csv=receiptCSV(rows,count,{anna:'Анна'});
 assert.match(csv,/"-2"/);
 assert.match(csv,/"'=HYPERLINK/);
 assert.match(csv,/"'\+unsafe formula"/);
});

import {validateRange,assortmentRef,loadSupplies} from '../cloudflare/moysklad-read.mjs';
import {candidates,collectDelivered,compareSelected,productLinkKey} from '../js/landa-moysklad-match.mjs';

test('MoySklad receiving dates accept inclusive dates and reject invalid or oversized ranges',()=>{
 assert.deepEqual(validateRange('2026-10-01','2026-10-29'),{from:'2026-10-01',to:'2026-10-29'});
 for(const dates of [['2026-02-30','2026-03-01'],['2026-10-29','2026-10-01'],['2026-01-01','2026-10-01']])
  assert.throws(()=>validateRange(...dates));
});
test('MoySklad assortment references are limited to official API entity URLs',()=>{
 const id='bb8eb29c-2a84-4a60-98c2-91241d89d140';
 assert.deepEqual(assortmentRef({meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+id}}),{type:'product',id});
 assert.equal(assortmentRef({meta:{href:'https://evil.test/api/remap/1.2/entity/product/'+id}}),null);
 assert.equal(assortmentRef({meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/employee/'+id}}),null);
});
test('MoySklad admin endpoint blocks unknown owner key before any API request',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Network called unexpectedly')};
 try{
  const request=post('/admin/moysklad-supplies',{adminKey:'wrong',from:'2026-10-01',to:'2026-10-29'});
  const result=await worker.fetch(request,{...env,LANDA_MS_ADMIN_KEY:'x'.repeat(40),MOYSKLAD_TOKEN:'test'});
  assert.equal(result.status,403);assert.equal(calls,0);
 }finally{globalThis.fetch=old}
});
test('MoySklad read-only API projects supplies and products without any writes',async()=>{
 const productId='bb8eb29c-2a84-4a60-98c2-91241d89d140';
 const docId='ac71830c-1a84-4a60-98c2-91241d89d150';
 const original=globalThis.fetch,methods=[];
 globalThis.fetch=async(url,options)=>{
  methods.push(options.method);
  const u=new URL(url);
  if(u.pathname.endsWith('/entity/supply'))return new Response(JSON.stringify({
   rows:[{id:docId,name:'TEST-SUPPLY',moment:'2026-10-29 12:00:00',applicable:true,agent:{name:'Поставщик'},store:{name:'Склад'}}],
   meta:{} }),{status:200});
  if(u.pathname.endsWith('/positions'))return new Response(JSON.stringify({rows:[{id:'line-1',quantity:3,assortment:{
   meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+productId}
  }}],meta:{}}),{status:200});
  if(u.pathname.endsWith('/product/'+productId))return new Response(JSON.stringify({name:'Dyson TEST',article:'DYS-T',code:'TEST'}),{status:200});
  throw Error('Unexpected endpoint '+u.pathname);
 };
 try{
  const result=await loadSupplies({MOYSKLAD_TOKEN:'synthetic-token'},'2026-10-01','2026-10-29');
  assert.deepEqual(methods,['GET','GET','GET']);
  assert.equal(result.documents.length,1);
  assert.equal(result.documents[0].positions[0].name,'Dyson TEST');
  assert.equal(result.documents[0].positions[0].quantity,3);
  assert.equal(JSON.stringify(result).includes('synthetic-token'),false);
 }finally{globalThis.fetch=original}
});
test('MoySklad only delivered LANDA shipments are eligible for comparison',()=>{
 const invoices=[
  {id:'d',supplierId:'anna',date:'2026-10-01',status:'delivered',items:[{name:'Dyson',qty:2}]},
  {id:'t',supplierId:'anna',date:'2026-10-02',status:'transit',items:[{name:'Dyson',qty:100}]},
  {id:'o',supplierId:'alina',date:'2026-10-02',status:'delivered',items:[{name:'Dyson',qty:10}]}
 ];
 const before=JSON.stringify(invoices);
 const rows=collectDelivered(invoices,'anna','2026-10-29');
 assert.equal(rows.length,1);assert.equal(rows[0].qty,2);
 assert.equal(JSON.stringify(invoices),before);
});
test('matching exact names is automatic; ambiguous names require confirmation',()=>{
 const catalog=[{id:'p1',name:'Dyson Big Ball Multifloor 2',sku:''},{id:'p2',name:'Dyson Big Ball Multifloor',sku:''}];
 const exact=candidates({name:'Dyson Big Ball Multifloor 2',sku:''},catalog);
 assert.equal(exact.best.id,'p1');assert.equal(exact.automatic,true);
 const fuzzy=candidates({name:'Dyson Big Ball',sku:''},catalog);
 assert.equal(fuzzy.automatic,false);
 const linked=candidates({name:'Dyson Big Ball',sku:''},catalog,'p2');
 assert.equal(linked.best.id,'p2');assert.equal(linked.automatic,true);
});
test('reconciliation totals include shortages, unlinked and mixed-name shared products safely',()=>{
 const rows=[{name:'Dyson A',sku:'A',qty:3,invoiceNumber:'TEST-1'}];
 const docs=[{positions:[{productId:'p1',name:'Dyson A',sku:'A',quantity:2}]}];
 let r=compareSelected(rows,docs,{},'anna');
 assert.equal(r.results[0].state,'difference');
 assert.equal(r.results[0].delta,-1);
 const links={[productLinkKey('anna','Unknown X','Q')]:'p1'};
 r=compareSelected([{name:'Unknown X',sku:'Q',qty:1,invoiceNumber:'TEST-1'}],docs,links,'anna');
 assert.equal(r.results[0].state,'difference');
 assert.equal(r.results[0].received,2);
 r=compareSelected([{name:'Dyson A',sku:'A',qty:1,invoiceNumber:'TEST-1'},{name:'Unknown X',sku:'Q',qty:1,invoiceNumber:'TEST-2'}],docs,links,'anna');
 assert.equal(r.results.every(x=>x.state==='shared'),true);
 assert.equal(r.results[0].sharedExpected,2);
 assert.equal(r.results[0].sharedDifference,0);
});

test('read-only MoySklad connection check requires owner key and makes no request for invalid code',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Never fetch with bad key')};
 try{
  const request=post('/admin/moysklad-check',{adminKey:'wrong'});
  const response=await worker.fetch(request,{...env,LANDA_MS_ADMIN_KEY:'x'.repeat(40),MOYSKLAD_TOKEN:'synthetic'});
  assert.equal(response.status,403);
  assert.equal(calls,0);
 }finally{globalThis.fetch=previous}
});
test('read-only MoySklad connection check returns only health metadata after a GET request',async()=>{
 const previous=globalThis.fetch,requested=[];
 globalThis.fetch=async(url,options)=>{
  requested.push({url,method:options.method});
  assert.match(url,/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/supply\?limit=1$/);
  return new Response(JSON.stringify({rows:[{id:'test-only',name:'Private supplier data'}],meta:{}}),{status:200});
 };
 try{
  const response=await worker.fetch(post('/admin/moysklad-check',{adminKey:'x'.repeat(40)}),
   {...env,LANDA_MS_ADMIN_KEY:'x'.repeat(40),MOYSKLAD_TOKEN:'synthetic-secret'});
  assert.equal(response.status,200);
  const out=await response.json();
  assert.equal(out.ok,true);
  assert.equal(out.access,'read-only');
  assert.equal(JSON.stringify(out).includes('Private supplier data'),false);
  assert.equal(JSON.stringify(out).includes('synthetic-secret'),false);
  assert.equal(requested.length,1);
  assert.equal(requested[0].method,'GET');
 }finally{globalThis.fetch=previous}
});
