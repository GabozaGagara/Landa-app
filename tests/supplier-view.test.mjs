import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierOverview} from '../cloudflare/supplier-view.mjs';
function demo(){
 return {operations:{
  invoices:[
   {id:'i1',supplierId:'anna',date:'2026-10-28',seq:1,number:'TRACK1',tracking:'TRACK1',status:'created',total:100,goodsCost:100,accrued:false,items:[{name:'Тест',qty:1,price:100}],submittedAt:'2026-10-28T01:00:00Z'},
   {id:'i2',supplierId:'anna',date:'2026-10-27',seq:2,number:'TRACK2',tracking:'TRACK2',status:'delivered',total:200,goodsCost:200,accrued:true,items:[],reviewStatus:'approved'},
   {id:'i3',supplierId:'alina',date:'2026-10-28',seq:3,number:'SECRET',tracking:'SECRET',status:'delivered',total:900,accrued:true,items:[]}
  ],
  payments:[
   {id:'p1',supplierId:'anna',amount:150,date:'2026-10-28'},
   {id:'p2',supplierId:'alina',amount:450,date:'2026-10-28'}
  ],
  allocations:[
   {id:'a1',paymentId:'p1',invoiceId:'i2',amount:110},
   {id:'a2',paymentId:'p2',invoiceId:'i3',amount:400}
  ]
 }};
}
test('only requested supplier invoices and item details are returned',()=>{
 const anna=supplierOverview(demo(),'anna',1);
 assert.equal(anna.invoices.length,2);
 assert.ok(anna.invoices.every(x=>x.tracking!=='SECRET'));
 assert.equal(anna.summary.count,2);
 assert.equal(anna.supplier.id,'anna');
});
test('balance equals payments minus accrued invoices; pending invoices do not create debt',()=>{
 const anna=supplierOverview(demo(),'anna',1);
 assert.equal(anna.summary.paid,150);
 assert.equal(anna.summary.accrued,200);
 assert.equal(anna.summary.balance,-50);
 assert.equal(anna.summary.allocated,110);
 assert.equal(anna.summary.open,90);
 assert.equal(anna.summary.advance,40);
 assert.equal(anna.summary.pendingAmount,100);
 assert.equal(anna.summary.pendingCount,1);
});
test('review state is scoped and defaults to pending for submitted invoices',()=>{
 const anna=supplierOverview(demo(),'anna',1);
 const pending=anna.invoices.find(x=>x.tracking==='TRACK1');
 assert.equal(pending.reviewStatus,'pending');
 assert.equal(anna.invoices.find(x=>x.tracking==='TRACK2').reviewStatus,'approved');
});
test('pagination and wrong supplier fail safely',()=>{
 assert.equal(supplierOverview(demo(),'anna',2).invoices.length,0);
 assert.throws(()=>supplierOverview(demo(),'unknown',1));
 assert.throws(()=>supplierOverview(demo(),'anna',0));
});
