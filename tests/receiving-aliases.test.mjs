import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 collectShipmentRows,compareCount,aggregateProducts,productIdentity,safeProductAliases,
 mergeProductAliases,unmergeProductAliases,renameProductAlias,filterProductSummary,receiptCSV
} from '../js/landa-receiving-core.mjs';

// Synthetic source-only invoice data. No real private financial files are loaded.
const makeInvoices=()=>[
 {id:'i1',supplierId:'anna',number:'INVOICE1',status:'transit',items:[
  {name:'Karcher Puzzi 10/1',sku:'',qty:3,price:100},{name:'Dyson Absolute 2 Красный',sku:'',qty:2,price:300}
 ]},
 {id:'i2',supplierId:'anatoly',number:'INVOICE2',status:'transit',items:[
  {name:'Моющий пылесос Puzzi 10/1',sku:'',qty:5,price:100},{name:'Dyson absolute red',sku:'',qty:1,price:300}
 ]},
 {id:'i3',supplierId:'anna',number:'INVOICE3',status:'transit',items:[
  {name:'Karcher Puzzi 10/1',sku:'',qty:2,price:100}
 ]}
];
const setup=()=>{
 const invoices=makeInvoices(),rows=collectShipmentRows(invoices),counts={};
 const pick=(id,index)=>rows.find(r=>r.invoiceId===id&&r.itemIndex===index);
 counts[pick('i1',0).key]={received:3};
 counts[pick('i2',0).key]={received:4}; // Missing one unit.
 counts[pick('i1',1).key]={received:2};
 counts[pick('i2',1).key]={received:1};
 return {invoices,rows,counts,pick};
};
const joinByNames=(aliases,products,a,b,title,id)=>{
 const first=products.find(p=>p.name===a),second=products.find(p=>p.name===b);
 assert.ok(first&&second);
 return mergeProductAliases(aliases,[first,second],title,id);
};
test('original aggregation separates differently named products even from different suppliers',()=>{
 const {invoices,rows,counts}=setup(),before=JSON.stringify(invoices);
 const products=aggregateProducts(rows,counts);
 assert.equal(products.length,4);
 assert.equal(products.find(g=>g.name==='Karcher Puzzi 10/1').expected,5);
 assert.equal(products.find(g=>g.name==='Моющий пылесос Puzzi 10/1').expected,5);
 assert.equal(JSON.stringify(invoices),before);
});
test('owner manually merges Puzzi 10/1 across suppliers and can undo without financial changes',()=>{
 const {invoices,rows,counts}=setup(),before=JSON.stringify(invoices),beforeRows=JSON.stringify(rows),beforeCounts=JSON.stringify(counts);
 const old=aggregateProducts(rows,counts),aliases=joinByNames({version:1,groups:[]},old,
  'Karcher Puzzi 10/1','Моющий пылесос Puzzi 10/1','Karcher Puzzi 10/1','group-puzzi');
 const products=aggregateProducts(rows,counts,aliases),puzzi=products.find(p=>p.aliasId==='group-puzzi');
 assert.equal(products.length,3);assert.equal(puzzi.expected,10);
 assert.equal(puzzi.received,null,'Partial count must not be called fully received');
 assert.equal(puzzi.delta,null);
 assert.equal(puzzi.done,2);assert.equal(puzzi.lines,3);
 assert.deepEqual(new Set(puzzi.suppliers),new Set(['anna','anatoly']));
 assert.equal(puzzi.invoices.length,3);
 assert.equal(puzzi.variants.length,2);
 assert.equal(JSON.stringify(invoices),before);assert.equal(JSON.stringify(rows),beforeRows);
 assert.equal(JSON.stringify(counts),beforeCounts);
 const original=aggregateProducts(rows,counts,unmergeProductAliases(aliases,'group-puzzi'));
 assert.equal(original.length,4);
});
test('manual Dyson merge preserves separate SKU/name auditability and exact received counts',()=>{
 const {rows,counts}=setup(),before=aggregateProducts(rows,counts);
 const aliases=joinByNames({version:1,groups:[]},before,
  'Dyson Absolute 2 Красный','Dyson absolute red','Dyson Absolute Красный','group-dyson');
 const group=aggregateProducts(rows,counts,aliases).find(g=>g.aliasId==='group-dyson');
 assert.equal(group.expected,3);assert.equal(group.received,3);assert.equal(group.delta,0);
 assert.equal(group.done,group.lines);
 assert.deepEqual(new Set(group.variants.map(v=>v.name)),
  new Set(['Dyson Absolute 2 Красный','Dyson absolute red']));
 const renamed=renameProductAlias(aliases,'group-dyson','Dyson Absolute Red');
 assert.equal(aggregateProducts(rows,counts,renamed).find(p=>p.aliasId==='group-dyson').name,'Dyson Absolute Red');
 assert.equal(aggregateProducts(rows,counts,aliases).find(p=>p.aliasId==='group-dyson').name,'Dyson Absolute Красный');
});
test('status and name filters preserve entire merged product quantities',()=>{
 const {rows,counts}=setup(),products=aggregateProducts(rows,counts);
 const aliases=joinByNames({version:1,groups:[]},products,'Karcher Puzzi 10/1','Моющий пылесос Puzzi 10/1',
  'Puzzi 10/1','group-puzzi');
 const grouped=aggregateProducts(rows,counts,aliases);
 for(const filters of [{search:'моющий пылесос'},{search:'Puzzi 10/1'},{status:'difference'},{search:'INVOICE2'}]){
  const result=filterProductSummary(grouped,rows,counts,filters);
  const puzzi=result.find(p=>p.aliasId==='group-puzzi');
  assert.ok(puzzi,'Merged group missing with '+JSON.stringify(filters));
  assert.equal(puzzi.expected,10);
  assert.equal(puzzi.received,null);
  assert.equal(puzzi.done,2);
 }
 const pick=(id)=>rows.find(r=>r.invoiceId===id&&r.name.includes('Puzzi'));
 const updated={...counts,[pick('i3').key]:{received:2}};
 const complete=aggregateProducts(rows,updated,aliases).find(p=>p.aliasId==='group-puzzi');
 assert.equal(complete.received,9);
 assert.equal(complete.delta,-1);
 assert.equal(complete.done,complete.lines);
});
test('merging an existing alias group with a third source preserves every original member',()=>{
 const {rows,counts}=setup(),old=aggregateProducts(rows,counts);
 let aliases=joinByNames({version:1,groups:[]},old,'Karcher Puzzi 10/1','Моющий пылесос Puzzi 10/1',
  'Puzzi 10/1','group-old');
 const newer=aggregateProducts(rows,counts,aliases);
 aliases=mergeProductAliases(aliases,[newer.find(g=>g.aliasId==='group-old'),newer.find(g=>g.name==='Dyson absolute red')],
  'Промо комплект','group-new');
 assert.equal(aliases.groups.length,1);
 assert.equal(aliases.groups[0].members.length,3);
 const merged=aggregateProducts(rows,counts,aliases).find(g=>g.aliasId==='group-new');
 assert.equal(merged.expected,11);
 assert.equal(merged.received,null);
 assert.equal(merged.variants.length,3);
});
test('SKU is part of stable identity; payment data and reconciliation records are independent of aliases',()=>{
 const {invoices,rows,counts}=setup();
 const original=JSON.stringify({invoices,counts});
 const before=productIdentity(rows[0]);
 assert.equal(productIdentity({...rows[0],qty:999,price:888}),before);
 assert.notEqual(productIdentity({...rows[0],sku:'DIFFERENT-SKU'}),before);
 const oldCSV=receiptCSV(rows,counts);
 const aliases=joinByNames({version:1,groups:[]},aggregateProducts(rows,counts),
  'Karcher Puzzi 10/1','Моющий пылесос Puzzi 10/1','Puzzi','grp');
 aggregateProducts(rows,counts,aliases);
 assert.equal(receiptCSV(rows,counts),oldCSV);
 assert.equal(JSON.stringify({invoices,counts}),original);
});
test('safe alias import rejects malformed groups and repeated members',()=>{
 const {rows}=setup(),keys=rows.map(productIdentity);
 const data={version:1,groups:[
  {id:'one',name:'Puzzi 10/1',members:[keys[0],keys[1]]},
  {id:'another',name:'Incorrect overlap',members:[keys[0],keys[2]]},
  {id:'broken',name:'',members:['x','y']}
 ]};
 const v=safeProductAliases(data);
 assert.equal(v.groups.length,1);
 assert.equal(v.groups[0].id,'one');
 assert.throws(()=>mergeProductAliases(v,[],'Puzzi','more'));
});
test('reconciliation UI provides manual merge, unmerge, rename and portable alias settings',()=>{
 const ui=readFileSync(new URL('../js/landa-receiving-ui.mjs',import.meta.url),'utf8');
 for(const label of ['rcMergeToggle','rcMergeSave','rcAliasDownload','rcAliasUpload','data-rc-unmerge','data-rc-rename','filterProductSummary','rcExportMerged'])
  assert.ok(ui.includes(label),label);
 assert.doesNotMatch(ui,/\bsaveOps\s*\(/);
 assert.doesNotMatch(ui,/\bops\.invoices\s*=/);
 assert.match(ui,/landa_receiving_product_aliases_v1/);
});


test('shipment delivery status filters created, transit, ready and delivered including legacy received',()=>{
 const invoices=[
  {id:'1',supplierId:'anna',status:'created',items:[{name:'Puzzi 10/1',qty:1}]},
  {id:'2',supplierId:'anna',status:'transit',items:[{name:'Puzzi 10/1',qty:2}]},
  {id:'3',supplierId:'anna',status:'ready',items:[{name:'Puzzi 10/1',qty:3}]},
  {id:'4',supplierId:'anna',status:'delivered',items:[{name:'Puzzi 10/1',qty:4}]},
  {id:'5',supplierId:'anna',status:'received',items:[{name:'Puzzi 10/1',qty:5}]},
  {id:'6',supplierId:'alina',status:'ready',items:[{name:'Puzzi 10/1',qty:10}]},
 ];
 const original=JSON.stringify(invoices);
 const quantities={all:25,created:1,transit:2,ready:13,delivered:9};
 for(const [deliveryStatus,expected] of Object.entries(quantities)){
  const rows=collectShipmentRows(invoices,{deliveryStatus});
  assert.equal(rows.reduce((sum,r)=>sum+r.qty,0),expected,deliveryStatus);
 }
 assert.equal(collectShipmentRows(invoices,{supplier:'anna',deliveryStatus:'ready'}).length,1);
 assert.equal(collectShipmentRows(invoices,{supplier:'alina',deliveryStatus:'ready'}).length,1);
 assert.equal(collectShipmentRows(invoices,{deliveryStatus:'all'}).length,6);
 assert.equal(JSON.stringify(invoices),original,'Filtering never updates invoice statuses');
});

test('manual aliases sum only selected delivery status and never claim an unchecked status complete',()=>{
 const invoices=[
  {id:'transit-a',supplierId:'anna',number:'TRANSIT',status:'transit',
   items:[{name:'Karcher Puzzi 10/1',qty:4}]},
  {id:'ready-a',supplierId:'anna',number:'READY',status:'ready',
   items:[{name:'Karcher Puzzi 10/1',qty:2}]},
  {id:'ready-b',supplierId:'anatoly',number:'READY2',status:'ready',
   items:[{name:'Моющий пылесос Puzzi 10/1',qty:3}]},
  {id:'delivered-a',supplierId:'anatoly',number:'DELIVERED',status:'delivered',
   items:[{name:'Моющий пылесос Puzzi 10/1',qty:5}]},
 ];
 const all=collectShipmentRows(invoices);
 const counts={};
 for(const r of all.filter(r=>r.status==='transit'||r.invoice==='READY'))
  counts[r.key]={received:r.qty};
 const original=JSON.stringify({invoices,counts});
 const originalGroups=aggregateProducts(all,counts);
 const aliases=joinByNames({version:1,groups:[]},originalGroups,
  'Karcher Puzzi 10/1','Моющий пылесос Puzzi 10/1','Karcher Puzzi 10/1','puzzi-all');
 const byStatus=(deliveryStatus,filter={})=>{
  const rows=collectShipmentRows(invoices,{deliveryStatus});
  return filterProductSummary(aggregateProducts(rows,counts,aliases),rows,counts,filter)
    .find(g=>g.aliasId==='puzzi-all');
 };
 const transit=byStatus('transit');
 assert.equal(transit.expected,4);
 assert.equal(transit.received,4);
 assert.equal(transit.delta,0);
 assert.equal(transit.done,transit.lines);
 const ready=byStatus('ready');
 assert.equal(ready.expected,5);
 assert.equal(ready.received,null);
 assert.equal(ready.done,1);
 assert.equal(ready.lines,2);
 const delivered=byStatus('delivered');
 assert.equal(delivered.expected,5);
 assert.equal(delivered.received,null);
 assert.equal(delivered.done,0);
 const allStatus=byStatus('all');
 assert.equal(allStatus.expected,14);
 assert.equal(allStatus.received,null);
 assert.equal(byStatus('ready',{search:'Karcher'}).expected,5,'Search must preserve all ready lines');
 assert.equal(byStatus('ready',{status:'pending'}).expected,5,'Reconciliation status must preserve all ready lines');
 assert.equal(JSON.stringify({invoices,counts}),original);
});

test('UI keeps shipping status separate from reconciliation status and applies it to CSV export',()=>{
 const ui=readFileSync(new URL('../js/landa-receiving-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/id="rcDeliveryStatus"/);
 for(const [code,label] of [['transit','В пути'],['ready','Готов к выдаче'],['delivered','Вручен']])
  assert.ok(ui.includes('value="'+code+'">'+label),code);
 assert.match(ui,/id="rcStatus"/);
 assert.match(ui,/deliveryStatus:\$\('rcDeliveryStatus'\)\.value/);
 assert.match(ui,/rcExportMerged[\s\S]*?deliveryStatus:\$\('rcDeliveryStatus'\)\.value/);
 assert.match(ui,/rcSupplier','rcStatus','rcDeliveryStatus','rcOnlyPortal/);
});
