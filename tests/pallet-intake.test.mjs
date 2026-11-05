import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 PALLET_STORAGE_KEY,palletEmpty,palletValidate,palletCreate,palletSelect,palletExpected,
 palletAdd,palletEditEntry,palletRemoveEntry,palletClose,palletSummary,palletSuggestions,
 palletInvoiceKey,palletInvoiceSnapshot,palletShortNumber,palletCSV
} from '../js/landa-pallet-core.mjs';
import {palletSettlementEligibility,preparePalletSettlement,applyPalletSettlement}
 from '../js/landa-pallet-settlement.mjs';

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
 assert.equal(report[1].actualUnits,2,'Each place is one product unit');
 assert.equal(report[1].differencePlaces,-1);
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
test('plan comes from the supplier manifest and differences are automatic, even for legacy expected places',()=>{
 let b=select(create(),first);b=add(b,'p1',first,'Puzzi',2,2);
 let report=palletSummary(b.sessions[0])[0];
 assert.equal(report.differencePlaces,-1);
 assert.equal(report.expectedUnits,3);
 assert.equal(report.actualUnits,2);
 b=palletExpected(b,'sess1',palletInvoiceKey(first),9);
 report=palletSummary(b.sessions[0])[0];
 assert.equal(report.differencePlaces,-1);
 b=palletExpected(b,'sess1',palletInvoiceKey(first),'');
 assert.equal(palletSummary(b.sessions[0])[0].differencePlaces,-1);
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
 assert.match(csv,/Мест \/ штук фактически/);
 assert.match(csv,/Мест = штук товара/);
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
 assert.match(ui,/Мест \(= товаров, шт\.\)/);
 assert.doesNotMatch(ui,/id="plUnits"|data-pl-expected/);
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
 assert.equal(v.actualUnits,4);
 assert.equal(v.differencePlaces,1);
});
test('manifest reports still-unseen items and actual shortage by places',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Karcher Puzzi 10/1',1);
 const v=palletSummary(b.sessions[0])[0];
 assert.deepEqual(v.notLoaded.map(x=>x.name),['Dyson Absolute Red']);
 assert.equal(v.differencePlaces,-2);
 assert.equal(v.matchedPositions,1);
});

test('automatic position check equates each recorded place to one item unit',()=>{
 const before=JSON.stringify(first);
 let b=select(create(),first);
 b=add(b,'p1',first,'KARCHER PUZZI 10/1',3);
 const v=palletSummary(b.sessions[0])[0];
 assert.equal(v.plannedPositions,2);
 assert.equal(v.matchedPositions,1);
 assert.equal(v.missingPositions,1);
 assert.equal(v.uncheckedQuantities,0);
 assert.equal(v.unexpectedPositions,0);
 assert.deepEqual(v.positionChecks.map(x=>x.state),['difference','not_loaded']);
 assert.equal(v.positionChecks[0].expected,2);
 assert.equal(v.positionChecks[0].received,3);
 assert.equal(v.positionChecks[0].places,3);
 assert.equal(v.positionChecks[0].delta,1);
 assert.equal(v.actualUnits,3);
 assert.equal(JSON.stringify(first),before,'The financial invoice must remain unchanged');
});

test('automatic check detects exact shortages, unexpected products and ignores old manually specified units',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Karcher Puzzi 10/1',1,1);
 b=add(b,'p2',first,'Dyson Absolute Red',1,2);
 b=add(b,'p3',first,'Extra item',1);
 const v=palletSummary(b.sessions[0])[0];
 assert.equal(v.missingPositions,0);
 assert.equal(v.unexpectedPositions,1);
 assert.equal(v.uncheckedQuantities,0);
 assert.equal(v.differentQuantities,1);
 assert.deepEqual(v.positionChecks.map(x=>x.state),['difference','matched','unexpected']);
 assert.deepEqual(v.positionChecks.map(x=>x.delta),[-1,0,1]);
 assert.match(palletCSV(b.sessions[0]),/АВТОСВЕРКА ПОЗИЦИЙ/);
 assert.match(palletCSV(b.sessions[0]),/Нет в накладной/);
 assert.match(palletCSV(b.sessions[0]),/Расхождение по штукам/);
});

test('old journal rows become fully verified by place count without editing stored units',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Karcher Puzzi 10/1',2,null);
 b=add(b,'p2',first,'Dyson Absolute Red',1,9);
 const raw=JSON.stringify(b);
 const report=palletSummary(b.sessions[0])[0];
 assert.equal(report.actualUnits,3);
 assert.equal(report.expectedUnits,3);
 assert.equal(report.differencePlaces,0);
 assert.equal(report.differentQuantities,0);
 assert.deepEqual(report.positionChecks.map(x=>x.state),['matched','matched']);
 assert.equal(JSON.stringify(b),raw,'Historical records and old units remain untouched');
 b=palletClose(b,'sess1',true);
 assert.equal(palletSettlementEligibility(palletSummary(b.sessions[0])[0],true).ready,true);
});

test('4 extra places in one declared product block settlement even if another product matches',()=>{
 let b=select(create(),first);
 b=add(b,'p1',first,'Karcher Puzzi 10/1',6);
 b=add(b,'p2',first,'Dyson Absolute Red',1);
 const v=palletSummary(b.sessions[0])[0];
 assert.equal(v.actualUnits,7);
 assert.equal(v.expectedUnits,3);
 assert.equal(v.differencePlaces,4);
 assert.equal(v.differentQuantities,1);
 assert.deepEqual(v.positionChecks.map(x=>x.delta),[4,0]);
 b=palletClose(b,'sess1',true);
 assert.equal(palletSettlementEligibility(palletSummary(b.sessions[0])[0],true).ready,false);
 assert.throws(()=>preparePalletSettlement(b,financial(first),'sess1',[palletInvoiceKey(first)]),/количество/i);
});

test('same product names are compared within their own supplier invoice, not across invoices',()=>{
 let b=select(select(create(),first),second);
 b=add(b,'p1',second,'Puzzi 10/1',3);
 const [a,c]=palletSummary(b.sessions[0]);
 assert.equal(a.matchedPositions,0);
 assert.equal(a.missingPositions,2);
 assert.equal(c.matchedPositions,1);
 assert.equal(c.missingPositions,0);
 assert.equal(c.positionChecks[0].state,'matched');
});

test('pallet interface displays an automatic manifest and visible per-position results',()=>{
 const ui=readFileSync(new URL('../js/landa-pallet-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/id="plManifest"/);
 assert.match(ui,/data-pl-manifest/);
 assert.match(ui,/Сверка позиций/);
 assert.match(ui,/v\.positionChecks\.map/);
 assert.match(ui,/Ещё не отмечено/);
});

const financial=(...sources)=>({version:1,suppliers:[{id:'anna',name:'Анна'},{id:'alina',name:'Алина'}],
 invoices:sources.map(i=>({...structuredClone(i),goodsCost:100,deliveryCost:10,total:110,
  deliveryMissing:false,includeDelivery:true,accrued:false,submittedAt:at,reviewStatus:'approved'})),
 payments:[],allocations:[],cash:[]});
const complete=(b,i)=>{
 const key=palletInvoiceKey(i);
 for(const [j,item] of i.items.entries())b=add(b,'complete-'+i.id+'-'+j,i,item.name,item.qty);
 return b;
};

test('owner settlement is unavailable until every unit is recorded and intake is closed',()=>{
 let b=select(create(),first);
 let status=palletSettlementEligibility(palletSummary(b.sessions[0])[0],false);
 assert.equal(status.ready,false);
 b=complete(b,first);
 status=palletSettlementEligibility(palletSummary(b.sessions[0])[0],false);
 assert.equal(status.ready,false);
 b=palletClose(b,'sess1',true);
 assert.equal(palletSettlementEligibility(palletSummary(b.sessions[0])[0],true).ready,true);
});

test('confirmed pallet settlement charges once and changes only approved invoice status and audit metadata',()=>{
 let b=select(create(),first);b=complete(b,first);b=palletClose(b,'sess1',true);
 const ops=financial(first),original=JSON.stringify(ops);
 const plan=preparePalletSettlement(b,ops,'sess1',[palletInvoiceKey(first)]);
 assert.equal(plan.totalCents,11000);
 const changed=applyPalletSettlement(ops,plan,at);
 assert.equal(JSON.stringify(ops),original);
 assert.equal(changed.invoices[0].status,'delivered');
 assert.equal(changed.invoices[0].statusSource,'pallet-owner-confirmed');
 assert.equal(changed.invoices[0].trackingVerified,false);
 assert.equal(changed.invoices[0].accrued,true);
 assert.equal(changed.invoices[0].palletSessionId,'sess1');
 assert.equal(changed.invoices[0].total,110);
 assert.deepEqual(changed.payments,ops.payments);
 assert.deepEqual(changed.allocations,ops.allocations);
 assert.throws(()=>preparePalletSettlement(b,changed,'sess1',[palletInvoiceKey(first)]),/уже начислена/);
 assert.throws(()=>applyPalletSettlement(changed,plan,at),/уже начислена/);
});

test('batch settlement is all-or-nothing for two suppliers and sums amounts precisely',()=>{
 let b=select(select(create(),first),second);
 b=complete(complete(b,first),second);
 b=palletClose(b,'sess1',true);
 const ops=financial(first,second);ops.invoices[1].total=77.35;
 const keys=[palletInvoiceKey(first),palletInvoiceKey(second)];
 const plan=preparePalletSettlement(b,ops,'sess1',keys);
 assert.equal(plan.candidates.length,2);
 assert.equal(plan.totalCents,18735);
 const applied=applyPalletSettlement(ops,plan,at);
 assert.equal(applied.invoices.filter(i=>i.accrued).length,2);
 assert.equal(ops.invoices.filter(i=>i.accrued).length,0);
});

test('settlement refuses missing, mismatched and unexpected pickup products',()=>{
 let b=select(create(),first);
 for(const entry of [
  add(b,'unknown',first,'Karcher Puzzi 10/1',1),
  add(b,'short',first,'Karcher Puzzi 10/1',1,1),
  add(complete(b,first),'extra',first,'Other',1,1)
 ]){
  const closed=palletClose(entry,'sess1',true);
  assert.throws(()=>preparePalletSettlement(closed,financial(first),'sess1',[palletInvoiceKey(first)]),
   /накладной|количество|совпадения|отмечены/);
 }
});

test('settlement refuses edited manifests, unreviewed submissions, unknown delivery and payment allocations',()=>{
 let b=select(create(),first);b=complete(b,first);b=palletClose(b,'sess1',true);
 const key=palletInvoiceKey(first),base=financial(first);
 const changed=structuredClone(base);changed.invoices[0].items[0].qty=9;
 assert.throws(()=>preparePalletSettlement(b,changed,'sess1',[key]),/изменился/);
 const pending=structuredClone(base);pending.invoices[0].reviewStatus='pending';
 assert.throws(()=>preparePalletSettlement(b,pending,'sess1',[key]),/Центре контроля/);
 const missingDelivery=structuredClone(base);missingDelivery.invoices[0].deliveryMissing=true;
 assert.throws(()=>preparePalletSettlement(b,missingDelivery,'sess1',[key]),/доставки/);
 const allocated=structuredClone(base);allocated.allocations.push({invoiceId:first.id,paymentId:'old',amount:10});
 assert.throws(()=>preparePalletSettlement(b,allocated,'sess1',[key]),/зачёты/);
});

test('duplicate supplier product names with different SKUs require manual review before billing',()=>{
 const ambiguous=invoice('ambiguous','anna','INVOICE-AMBIGUOUS',[
  ['Spare part',1],['Spare part',2]
 ]);
 ambiguous.items[0].sku='A';ambiguous.items[1].sku='B';
 let b=select(create(),ambiguous);
 b=add(b,'p1',ambiguous,'Spare part',3);
 b=palletClose(b,'sess1',true);
 assert.equal(palletSettlementEligibility(palletSummary(b.sessions[0])[0],true).ready,true);
 assert.throws(()=>preparePalletSettlement(b,financial(ambiguous),'sess1',[palletInvoiceKey(ambiguous)]),/артикулы/);
});

test('owner confirmation is explicit and double-checks local versions before saving',()=>{
 const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const pallet=readFileSync(new URL('../js/landa-pallet-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/LANDA_PALLET_OWNER_APPROVE/);
 assert.match(ui,/askConfirmAsync\(question\)/);
 assert.match(ui,/localStorage\.getItem\(PALLET_STORAGE_KEY\)!==palletRaw/);
 assert.match(ui,/settlement\.applyPalletSettlement/);
 assert.match(pallet,/Подтвердить и начислить/);
 assert.match(pallet,/palletSettlementEligibility/);
 assert.match(pallet,/уже начислен долг поставщикам/);
});
