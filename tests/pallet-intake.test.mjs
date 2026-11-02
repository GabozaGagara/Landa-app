import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 PALLET_STORAGE_KEY,palletEmpty,palletValidate,palletCreate,palletSelect,palletExpected,
 palletAdd,palletEditEntry,palletRemoveEntry,palletClose,palletSummary,palletSuggestions,
 palletInvoiceKey,palletInvoiceSnapshot,palletShortNumber,palletCSV
} from '../js/landa-pallet-core.mjs';

const at='2026-11-02T12:00:00.000Z';
const invoice=(id,supplierId,number,items,status='ready')=>({id,supplierId,number,tracking:number,date:'2026-11-02',status,
 items:items.map(([name,qty])=>({name,qty,sku:''}))});
const first=invoice('inv-1111-a','anna','10337771111',[['Karcher Puzzi 10/1',2],['Dyson Absolute Red',1]]);
const second=invoice('inv-2222-b','alina','10338882222',[['Puzzi 10/1',3]]);
const collision=invoice('inv-1111-c','alina','10779991111',[['Motor',5]]);
const create=(name='Смешанная паллета')=>palletCreate(palletEmpty(),'sess1',at,name);
const select=(b,i)=>palletSelect(b,'sess1',i,true);
const add=(b,id,i,product,places=1,units='')=>
 palletAdd(b,'sess1',{id,invoiceKey:palletInvoiceKey(i),product,places,units,at});

test('mixed pallet 1111 → 2222 → 1111 preserves exact scan order and groups by full invoice ID',()=>{
 let b=create();
 b=select(select(b,first),second);
 b=add(b,'place1',first,'Karcher Puzzi 10/1',1);
 b=add(b,'place2',second,'Puzzi 10/1',2);
 b=add(b,'place3',first,'Dyson Absolute Red',1);
 const s=b.sessions[0],before=JSON.stringify(b);
 assert.deepEqual(s.entries.map(e=>e.invoiceKey),[
  palletInvoiceKey(first),palletInvoiceKey(second),palletInvoiceKey(first)
 ]);
 assert.equal(s.entries.length,3);
 const report=palletSummary(s);
 assert.equal(report.length,2);
 assert.equal(report[0].entries,2);assert.equal(report[0].places,2);
 assert.equal(report[0].positions,2);
 assert.deepEqual(report[0].products.map(x=>x.name),['Karcher Puzzi 10/1','Dyson Absolute Red']);
 assert.equal(report[1].entries,1);assert.equal(report[1].places,2);
 assert.equal(report[1].expectedUnits,3);
 assert.equal(report[1].actualUnits,null,'Do not equate boxes with product pieces');
 assert.equal(JSON.stringify(b),before);
});
test('same last four digits on different invoices never collide',()=>{
 let b=select(select(create(),first),collision);
 b=add(b,'place1',first,'Karcher',1);
 b=add(b,'place2',collision,'Motor',2);
 assert.equal(palletShortNumber(first),'1111');
 assert.equal(palletShortNumber(collision),'1111');
 assert.notEqual(palletInvoiceKey(first),palletInvoiceKey(collision));
 assert.equal(palletSummary(b.sessions[0]).length,2);
 assert.equal(palletSummary(b.sessions[0])[0].places,1);
 assert.equal(palletSummary(b.sessions[0])[1].places,2);
});
test('plan places is optional and difference only appears when entered',()=>{
 let b=select(create(),first);b=add(b,'p1',first,'Puzzi',2,2);
 let report=palletSummary(b.sessions[0])[0];
 assert.equal(report.differencePlaces,null);
 assert.equal(report.expectedUnits,3);
 assert.equal(report.actualUnits,2);
 b=palletExpected(b,'sess1',palletInvoiceKey(first),3);
 report=palletSummary(b.sessions[0])[0];
 assert.equal(report.differencePlaces,-1);
 b=palletExpected(b,'sess1',palletInvoiceKey(first),'');
 assert.equal(palletSummary(b.sessions[0])[0].differencePlaces,null);
});
test('pickup record corrections do not reorder log or change original source invoices',()=>{
 const originals=JSON.stringify([first,second]);
 let b=select(select(create(),first),second);
 b=add(b,'p1',first,'Karcher',1);
 b=add(b,'p2',second,'Puzzi',1);
 b=add(b,'p3',first,'Dyson',1);
 const prior=JSON.stringify(b);
 b=palletEditEntry(b,'sess1','p2',{invoiceKey:palletInvoiceKey(first),product:'Dyson Red',places:3,units:2});
 assert.deepEqual(b.sessions[0].entries.map(x=>x.id),['p1','p2','p3']);
 assert.equal(b.sessions[0].entries[1].at,at);
 assert.equal(b.sessions[0].entries[1].places,3);
 assert.equal(b.sessions[0].entries[1].invoiceKey,palletInvoiceKey(first));
 assert.notEqual(JSON.stringify(b),prior);
 b=palletRemoveEntry(b,'sess1','p1');
 assert.deepEqual(b.sessions[0].entries.map(x=>x.id),['p2','p3']);
 assert.equal(JSON.stringify([first,second]),originals);
});
test('cannot deselect invoice after recording places; cannot edit finished sessions',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Karcher',1);
 assert.throws(()=>palletSelect(b,'sess1',first,false),/есть записи/);
 b=palletClose(b,'sess1',true);
 for(const f of [
  ()=>add(b,'p2',first,'Dyson',1),
  ()=>palletExpected(b,'sess1',palletInvoiceKey(first),4),
  ()=>palletRemoveEntry(b,'sess1','p1'),
  ()=>palletEditEntry(b,'sess1','p1',{invoiceKey:palletInvoiceKey(first),product:'Dyson',places:1})
 ])assert.throws(f,/завершена/);
 b=palletClose(b,'sess1',false);
 b=add(b,'p2',first,'Dyson',1);
 assert.equal(b.sessions[0].entries.length,2);
});
test('product hints learn saved names from past sessions, prioritize current invoice and de-duplicate case',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Puzzi 10/1',1);
 b=palletCreate(b,'sess2','2026-11-03T10:00:00Z','Паллета 2');
 b=palletSelect(b,'sess2',second,true);
 const hints=palletSuggestions(b,b.sessions[1].invoices,palletInvoiceKey(second),'puzzi');
 assert.ok(hints.some(x=>x.toLowerCase().includes('puzzi')));
 assert.equal(hints.filter(x=>x.toLowerCase()==='puzzi 10/1').length,1);
 assert.ok(palletSuggestions(b,b.sessions[1].invoices,palletInvoiceKey(second)).includes('Puzzi 10/1'));
});
test('invalid parcel counts and corrupt archive are rejected without mutating stored journal',()=>{
 let b=select(create(),first),original=JSON.stringify(b);
 for(const places of [0,-1,1.5,'two',100001])assert.throws(()=>add(b,'p1',first,'Puzzi',places));
 assert.throws(()=>add(b,'p1',first,'',1));
 assert.throws(()=>add(b,'p1',first,'Puzzi',1,-5));
 assert.equal(JSON.stringify(b),original);
 assert.throws(()=>palletValidate({...b,version:2}),/формат/);
 const withPlace=add(b,'p1',first,'Puzzi',1);
 const broken=structuredClone(withPlace);broken.sessions[0].entries[0].invoiceKey='wrong';
 assert.throws(()=>palletValidate(broken),/отсутствует/);
});
test('CSV shows chronological records then summary with full numbers and prevents spreadsheet formulas',()=>{
 let b=select(create(),first);b=add(b,'p1',first,'=HYPERLINK("evil")',2,3);
 const csv=palletCSV(b.sessions[0]);
 assert.match(csv,/10337771111/);
 assert.match(csv,/1111/);
 assert.match(csv,/'=HYPERLINK/);
 assert.match(csv,/СВОДКА/);
 assert.match(csv,/Мест фактически/);
 assert.match(csv,/ПО ТОВАРАМ/);
 assert.match(csv,/HYPERLINK/);
 assert.equal(csv.startsWith('\ufeff'),true);
});
test('UI is integrated as third receiving tab without writes to financial ledgers',()=>{
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const receiving=readFileSync(new URL('../js/landa-receiving-ui.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../js/landa-pallet-ui.mjs',import.meta.url),'utf8');
 assert.match(index,/js\/landa-pallet-ui\.mjs/);
 assert.match(receiving,/id="rcPallet"/);
 assert.match(receiving,/LANDA_PALLET\?\.open/);
 assert.match(ui,/plInvoice/);
 assert.match(ui,/plProductHints/);
 assert.match(ui,/plExportCSV/);
 assert.match(ui,/plExportJSON/);
 assert.match(ui,/plImportJSON/);
 assert.match(ui,/plExpected/);
 assert.match(ui,/data-pl-suggest/);
 assert.match(ui,/data-pl-edit/);
 assert.match(ui,/plActiveInvoices/);
 assert.match(ui,/savedRaw/);
 assert.match(ui,/data-pl-delete/);
 assert.match(ui,/PALLET_STORAGE_KEY/);
 assert.doesNotMatch(ui,/\bsaveOps\s*\(|\bsave\s*\(|\bops\.invoices\s*=|GH_TOKEN|backup\.json/);
 assert.equal(PALLET_STORAGE_KEY,'landa_sdek_mixed_pallet_v1');
});


test('manifest highlights actual undeclared names without confusing different spellings or parcels',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Karcher Puzzi 10/1',1);
 b=add(b,'p2',first,'Dyson Absolute red',1);
 b=add(b,'p3',first,'Unknown product',2);
 const v=palletSummary(b.sessions[0])[0];
 assert.equal(v.hasManifest,true);
 assert.deepEqual(v.notLoaded,[]);
 assert.equal(v.unexpected.length,1);
 assert.equal(v.unexpected[0].name,'Unknown product');
 assert.equal(v.matchedPositions,2);
 assert.equal(v.places,4);
 assert.equal(v.expectedUnits,3);
 assert.equal(v.actualUnits,null);
});
test('manifest reports still-unseen item names but does not claim missing physical places',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Karcher Puzzi 10/1',1);
 const v=palletSummary(b.sessions[0])[0];
 assert.deepEqual(v.notLoaded.map(x=>x.name),['Dyson Absolute Red']);
 assert.equal(v.differencePlaces,null);
 assert.equal(v.matchedPositions,1);
});
