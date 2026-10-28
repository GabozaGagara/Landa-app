// LANDA CI: static checks and supplier access-projection accounting tests.
// Synthetic fixtures only; never fetches live credentials or financial backups.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Script} from 'node:vm';
import {supplierOverview} from '../cloudflare/supplier-view.mjs';

const root=resolve(import.meta.dirname,'..');
const read=p=>readFileSync(resolve(root,p),'utf8');

for(const path of ['index.html','supplier.html']){
 const html=read(path);
 assert.match(html,/^\s*<!doctype html>/i,path+' missing doctype');
 assert.match(html,/<\/body>\s*<\/html>\s*$/i,path+' was truncated');
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
 assert(scripts.length>0,path+' has no scripts');
 let count=0;
 for(const script of scripts){
  const [,attr,body]=script;
  if(/\bsrc\s*=/.test(attr)||/type\s*=\s*["']application\/json["']/.test(attr)||!body.trim())continue;
  new Script(body,{filename:path+' inline script '+(++count)});
 }
 assert(count>0,path+' contained no executable scripts');
 console.log('PASS',path,'valid inline scripts:',count);
}
for(const path of ['js/landa-control-center.js','js/landa-local-backups.js']){
 new Script(read(path),{filename:path});
 console.log('PASS',path,'JavaScript syntax');
}
const html=read('index.html');
assert.match(html,/<script src="\.\/js\/landa-control-center\.js" defer><\/script>/);
assert.match(html,/<script src="\.\/js\/landa-local-backups\.js" defer><\/script>/);
const form=read('supplier.html');
assert.match(form,/id="supplierOverview"/);
assert.match(form,/id="supplierOverviewRefresh"/);
assert.match(form,/async function loadSupplierOverview/);
assert.match(form,/rememberSupplierCode/);
assert.doesNotMatch(form,/github_pat_[A-Za-z0-9_]{15,}/,'Credentials must not be committed');

const worker=read('cloudflare/worker.mjs');
assert.match(worker,/import \{supplierOverview\} from '\.\/supplier-view\.mjs'/);
assert.match(worker,/u\.pathname==='\/supplier-overview'/);
assert.match(worker,/validateSupplierAccess\(data\.supplierId,data\.code,env\)/);
assert.match(worker,/reviewStatus:'pending'/);
const getRoute=worker.slice(worker.indexOf("u.pathname==='/supplier-overview'"),worker.indexOf("u.pathname==='/submit'"));
assert(getRoute.indexOf('validateSupplierAccess(')<getRoute.indexOf('await github(env)'), 'Authentication must precede GitHub data read');

const sample={
 operations:{
  suppliers:[{id:'anna',name:'Анна'},{id:'alina',name:'Алина'}],
  invoices:[
   {id:'a1',supplierId:'anna',number:'AN-1',tracking:'12345678',status:'created',accrued:false,total:123,goodsCost:123,date:'2026-10-25',items:[{name:'Товар A',qty:1,price:123}],privateMemo:'should-not-leak'},
   {id:'a2',supplierId:'anna',number:'AN-2',tracking:'12345679',status:'delivered',accrued:true,total:200,goodsCost:200,date:'2026-10-26',items:[{name:'Товар B',qty:2,price:100}]},
   {id:'a3',supplierId:'anna',number:'Начальный долг',isOpening:true,status:'received',total:40,date:'2026-10-01',items:[]},
   {id:'b1',supplierId:'alina',number:'AL-SECRET',status:'created',total:9000,date:'2026-10-27',items:[{name:'Не показывать',qty:1,price:9000}]}
  ],
  payments:[{id:'p1',supplierId:'anna',amount:70},{id:'p2',supplierId:'alina',amount:3000}],
  allocations:[{paymentId:'p1',invoiceId:'a2',amount:20},{paymentId:'p2',invoiceId:'b1',amount:50}],
  cash:[{note:'SECRET_CASH_INFORMATION',amount:500000}]
 },
 proschet:{rows:[{name:'SECRET_CALC'}]}
};
const overview=supplierOverview(sample,'anna',1);
assert.equal(overview.supplier.id,'anna');
assert.equal(overview.summary.balance,-170); // 70 paid - 200 billed - 40 opening debt
assert.equal(overview.summary.accrued,240);
assert.equal(overview.summary.paid,70);
assert.equal(overview.summary.allocated,20);
assert.equal(overview.summary.advance,50);
assert.equal(overview.summary.open,220);
assert.equal(overview.summary.pendingAmount,123);
assert.equal(overview.summary.pendingCount,1);
assert.equal(overview.pagination.total,2);
assert.equal(overview.invoices.length,2);
assert(overview.invoices.every(x=>x.number!=='AL-SECRET'));
assert(!JSON.stringify(overview).includes('should-not-leak'));
assert(!JSON.stringify(overview).includes('SECRET_CASH_INFORMATION'));
assert(!JSON.stringify(overview).includes('SECRET_CALC'));
assert(!JSON.stringify(overview).includes('AL-SECRET'));
assert.throws(()=>supplierOverview(sample,'unknown'),/поставщик/);
assert.throws(()=>supplierOverview(sample,'anna',0),/страниц/);
const empty=supplierOverview(sample,'anatoly',1);
assert.equal(empty.summary.balance,0);
assert.equal(empty.invoices.length,0);
console.log('PASS supplier-scoped accounting, isolation, pagination and access checks');
console.log('All LANDA source checks passed.');
