import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 collectDelivered,compareSelected,msDeliveryStatus,msInvoiceKey,
 isMoyskladInvoiceEligible,productLinkKey
} from '../js/landa-moysklad-match.mjs';

// Synthetic invoices only. Never read the live private finance backup or warehouse records.
const invoices=[
 {id:'same-id',supplierId:'anna',number:'A-01',date:'2026-10-20',status:'delivered',items:[{name:'Karcher Puzzi 10/1',sku:'K10',qty:2}]},
 {id:'same-id',supplierId:'alina',number:'B-01',date:'2026-10-21',status:'received',items:[{name:'Karcher Puzzi 10/1',sku:'K10',qty:3}]},
 {id:'t1',supplierId:'anatoly',number:'C-02',date:'2026-10-22',status:'transit',items:[{name:'Dyson Red',sku:'D',qty:4}]},
 {id:'r1',supplierId:'anna',number:'A-02',date:'2026-10-23',status:'ready',items:[{name:'Dyson Red',sku:'D',qty:1}]},
 {id:'c1',supplierId:'alina',number:'B-03',date:'2026-10-24',status:'created',items:[{name:'Dyson Red',sku:'D',qty:7}]},
 {id:'old',supplierId:'anna',number:'A-OLD',date:'2026-10-10',status:'delivered',items:[{name:'Old',qty:6}]},
 {id:'opening',supplierId:'anna',date:'2026-10-20',status:'delivered',isOpening:true,items:[{name:'Opening',qty:100}]}
];
test('all supplier mode includes delivered and legacy received invoices, default excludes transit',()=>{
 const before=JSON.stringify(invoices),rows=collectDelivered(invoices,'all','2026-10-23');
 assert.equal(rows.length,3);
 assert.equal(rows.reduce((sum,x)=>sum+x.qty,0),11);
 assert.deepEqual(new Set(rows.map(x=>x.supplierId)),new Set(['anna','alina']));
 assert.equal(msDeliveryStatus('received'),'delivered');
 assert.equal(JSON.stringify(invoices),before);
});
test('all status mode includes transit, ready, created and delivered, excludes opening and future-dated',()=>{
 const rows=collectDelivered(invoices,'all','2026-10-24','all');
 assert.equal(rows.length,6);
 assert.equal(rows.reduce((sum,r)=>sum+r.qty,0),23);
 assert.equal(collectDelivered(invoices,'all','2026-10-24','transit').length,1);
 assert.equal(collectDelivered(invoices,'all','2026-10-24','ready').length,1);
 assert.equal(collectDelivered(invoices,'all','2026-10-24','created').length,1);
 assert.equal(collectDelivered(invoices,'anna','2026-10-24','all').length,3);
 assert.equal(isMoyskladInvoiceEligible(invoices[6],'all','2026-10-24','all'),false);
});
test('duplicate invoice IDs at different suppliers have distinct selection identities',()=>{
 const rows=collectDelivered(invoices,'all','2026-10-22');
 assert.equal(rows.length,3);
 const selected=rows.filter(r=>r.selectionKey===msInvoiceKey('anna','same-id'));
 assert.equal(selected.length,1);
 assert.equal(selected[0].qty,2);
 assert.notEqual(msInvoiceKey('anna','same-id'),msInvoiceKey('alina','same-id'));
 assert.equal(rows.filter(r=>r.selectionKey===msInvoiceKey('alina','same-id')).length,1);
});
test('all-supplier comparison aggregates shared products without doubling warehouse quantities',()=>{
 const rows=collectDelivered(invoices,'all','2026-10-21');
 const docs=[{id:'m1',positions:[{productId:'stock-puzzi',name:'Karcher Puzzi 10/1',sku:'K10',quantity:5}]}];
 const result=compareSelected(rows,docs,{},'all');
 assert.equal(result.results.length,2); // Includes the older unrelated invoice ("Old").
 const puzzi=result.results.find(r=>r.name==='Karcher Puzzi 10/1');
 assert.equal(puzzi.expected,5);
 assert.equal(puzzi.received,5);
 assert.equal(puzzi.state,'matched');
 assert.deepEqual(new Set(puzzi.supplierIds),new Set(['anna','alina']));
 assert.deepEqual(new Set(puzzi.invoices),new Set(['A-01','B-01']));
 assert.equal(result.unmatchedProducts.length,0);
});
test('manual mapping in all mode is scoped to all, individual supplier mappings remain independent',()=>{
 const rows=collectDelivered(invoices,'all','2026-10-24','transit');
 const docs=[{positions:[{productId:'d1',name:'Dyson Absolute Red',sku:'D',quantity:4}]}];
 const links={[productLinkKey('all','Dyson Red','D')]:'d1',
  [productLinkKey('anna','Dyson Red','D')]:'different'};
 const grouped=compareSelected(rows,docs,links,'all');
 assert.equal(grouped.results.length,1);
 assert.equal(grouped.results[0].state,'matched');
 assert.equal(grouped.results[0].match.method,'manual');
 assert.equal(links[productLinkKey('anna','Dyson Red','D')],'different');
});
test('MoySklad UI supports bulk select of invoices and docs and names suppliers',()=>{
 const ui=readFileSync(new URL('../js/landa-moysklad-ui.mjs',import.meta.url),'utf8');
 for(const label of ['Все поставщики','msInvoiceStatus','Все статусы','msSelectAllInvoices','msSelectAllDocs','msClearInvoices','msClearDocs','msInvoiceKey','supplierName','msStatusWarning'])
  assert.ok(ui.includes(label),label);
 assert.match(ui,/currentInvoiceStatus\(\)/);
 assert.match(ui,/chosenInvoices=new Set\(invoices\(\)\.map/);
 assert.doesNotMatch(ui,/\bsaveOps\s*\(/);
});
test('CDEK list has separate delivery filter, payment filter, and legacy received normalization',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const dropdown=html.match(/<select id="invoiceDeliveryFilter"[\s\S]*?<\/select>/)?.[0];
 assert.ok(dropdown);
 for(const status of ['all','created','transit','ready','delivered'])assert.ok(dropdown.includes('value="'+status+'"'));
 const payment=html.match(/<select id="invoiceStateFilter"[\s\S]*?<\/select>/)?.[0];
 assert.ok(payment);
 assert.ok(payment.includes('value="open"'));
 assert.ok(payment.includes('value="paid"'));
 assert.doesNotMatch(payment,/value="transit"/,'Transit must be a delivery status, not payment status');
 assert.match(html,/deliveryFilter==='all'\|\|statusCode\(i\)===deliveryFilter/);
 assert.match(html,/what==='all'\|\|\(what==='open'/);
 assert.match(html,/invoiceDeliveryFilter'\)\.addEventListener\('change',renderInvoices\)/);
 assert.match(html,/statusCode=i=>i\.status==='received'\?'delivered'/);
});
