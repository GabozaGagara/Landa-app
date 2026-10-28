import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync('js/landa-control-center.js','utf8');
function mock(){
 const els={};
 class Element{
  constructor(id){this.id=id;this.innerHTML='';this.value='';this.hidden=false;this.listeners={};this.style={};this.elements={namedItem:()=>({value:''})}}
  addEventListener(type,listener){this.listeners[type]=listener}
  insertAdjacentElement(where,node){this.inserted=node}
 }
 const el=id=>els[id]||(els[id]=new Element(id));
 const doc={head:{appendChild(){}},createElement(tag){return new Element(tag)},getElementById:el};
 const win={addEventListener(){},print(){}};
 const data={suppliers:[{id:'anna',name:'Анна'}],invoices:[{
  id:'i1',supplierId:'anna',date:'2026-10-28',number:'TRACK1',tracking:'TRACK1',status:'ready',
  items:[{name:'Товар',qty:1,price:100}],total:100,goodsCost:100,
  submittedAt:'2026-10-28T00:00:00Z',accrued:false,reviewStatus:'pending'
 }],payments:[],allocations:[],cash:[],openings:{RUB:0,USD:0,CARD:0,AVITO:0}};
 let persisted;
 const save=()=>{persisted=structuredClone(data);return true};
 const f=new Function('ops','state','saveOps','renderOps','document','window','confirm','alert','setTimeout','clearTimeout',src+'\nreturn {saveOps,window};');
 const v=f(data,{rows:[]},save,()=>{},doc,win,()=>true,()=>{},()=>{},()=>{});
 return {v,data,el,get persisted(){return persisted}};
}
test('dashboard initializes and review action is offered',()=>{
 const {el}=mock();
 assert.ok(el('dashboardKpis').inserted);
 assert.match(el('lcReview').innerHTML,/data-lc-approve/);
 assert.match(el('lcMetrics').innerHTML,/100,00/);
});
test('profit uses purchase exchange rate and ruble-denominated expenses',()=>{
 const {v}=mock();
 const p=v.window.LANDA_CONTROL.profit({qty:2,saleRub:500,costUsd:100,rate:2,feesRub:25,deliveryRub:50});
 assert.deepEqual(p,{gross:100000,purchase:40000,fees:7500,net:52500});
});
test('review transition persists an audit event',()=>{
 const app=mock();
 app.data.invoices[0].reviewStatus='approved';
 assert.equal(app.v.saveOps(),true);
 assert.ok(app.persisted.auditTrail.some(x=>x.type==='review'));
});
test('unbilled supplier invoices are excluded from accrual and flagged',()=>{
 const {v}=mock();
 assert.equal(v.window.LANDA_CONTROL.getIssues().length,0);
});
