import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {palletEmpty,palletCreate,palletSelect,palletAdd,palletInvoiceKey}
 from '../js/landa-pallet-core.mjs';
import {palletLastPurchaseRate,palletStockReport,palletStockCSV}
 from '../js/landa-pallet-stock.mjs';

const at='2026-11-05T10:00:00.000Z';
const makeInvoice=(id,supplierId,items)=>({id,supplierId,number:id,date:'2026-11-04',
 items:items.map(([name,qty,price,sku=''])=>({name,qty,price,sku}))});
const a=makeInvoice('INV-1','anna',[['Karcher',3,100,'K1'],['Dyson',2,70,'D']]);
const b=makeInvoice('INV-2','alina',[['karcher',4,130,'K1']]);
const setup=(invoices=[a,b])=>{
 let book=palletCreate(palletEmpty(),'session',at,'Паллет');
 for(const invoice of invoices)book=palletSelect(book,'session',invoice,true);
 return book;
};
const add=(book,invoice,product,places,id)=>palletAdd(book,'session',{
 id,invoiceKey:palletInvoiceKey(invoice),product,places,units:'',at
});
const exchange=(date,rate,seq)=>({kind:'exchangeUSD',currency:'USD',amount:1000,rate,date,seq});

test('last actual dollar purchase rate is by accounting date and sequence, not array order',()=>{
 const cash=[exchange('2026-11-02',91,2),exchange('2026-11-03',95,4),
  {kind:'income',currency:'USD',amount:2000,rate:110,date:'2026-11-05'},
  exchange('2026-11-03',96,5),exchange('2026-11-01',99,6)];
 assert.deepEqual(palletLastPurchaseRate(cash),{rate:96,date:'2026-11-03'});
 assert.deepEqual(palletLastPurchaseRate([]),{rate:null,date:null});
});

test('warehouse list sums actually loaded places and computes quantity-weighted unit prices',()=>{
 let book=setup();
 book=add(book,a,'Karcher',2,'p1');
 book=add(book,b,'KARCHER',3,'p2');
 book=add(book,a,'Dyson',1,'p3');
 const before=JSON.stringify(book);
 const report=palletStockReport(book.sessions[0],[a,b],[exchange('2026-11-05',90,1)]);
 assert.equal(report.totalQuantity,6);
 assert.equal(report.rows.length,2);
 assert.deepEqual(report.rows.map(row=>row.name),['Dyson','Karcher']);
 assert.deepEqual(report.rows.map(row=>row.quantity),[1,5]);
 assert.equal(report.rows[1].unitUsd,118); // (2 × $100 + 3 × $130) / 5
 assert.equal(report.rows[1].unitRub,10620);
 assert.equal(report.rows[1].totalUsd,590);
 assert.equal(report.rows[1].totalRub,53100);
 assert.equal(report.rows[1].average,true);
 assert.equal(report.totalUsd,660);
 assert.equal(report.totalRub,59400);
 assert.equal(JSON.stringify(book),before,'Aggregation must not change the journal');
});

test('missing invoice price and latest purchase rate remain visibly unknown',()=>{
 let book=setup([a]);
 book=add(book,a,'Karcher',1,'p1');
 book=add(book,a,'Undeclared product',2,'p2');
 const report=palletStockReport(book.sessions[0],[a],[]);
 assert.equal(report.totalQuantity,3);
 assert.equal(report.rows.find(row=>row.name==='Karcher').unitUsd,100);
 assert.equal(report.rows.find(row=>row.name==='Karcher').unitRub,null);
 assert.equal(report.rows.find(row=>row.name==='Karcher').totalUsd,100);
 assert.equal(report.rows.find(row=>row.name==='Karcher').totalRub,null);
 assert.equal(report.rows.find(row=>row.name==='Undeclared product').unitUsd,null);
 assert.equal(report.totalUsd,null);
 assert.equal(report.totalRub,null);
 assert.equal(report.missingPrices,1);
});

test('products with same name but different SKU are not silently merged',()=>{
 const c=makeInvoice('INV-3','alina',[['Karcher',2,200,'K2']]);
 let book=setup([a,c]);
 book=add(book,a,'Karcher',2,'p1');
 book=add(book,c,'Karcher',2,'p2');
 const report=palletStockReport(book.sessions[0],[a,c],[exchange('2026-11-05',100,1)]);
 assert.equal(report.rows.length,2);
 assert.deepEqual(report.rows.map(row=>row.sku),['K1','K2']);
 assert.equal(report.rows.reduce((s,row)=>s+row.quantity,0),4);
});

test('ambiguous prices for multiple SKUs under one name are not invented',()=>{
 const ambiguous=makeInvoice('INV-A','anna',[
  ['Spare part',1,20,'A'],['Spare part',2,30,'B']]);
 let book=setup([ambiguous]);book=add(book,ambiguous,'Spare part',3,'p1');
 const report=palletStockReport(book.sessions[0],[ambiguous],[exchange('2026-11-05',90,1)]);
 assert.equal(report.rows[0].quantity,3);
 assert.equal(report.rows[0].unitUsd,null);
 assert.match(report.rows[0].issues.join(' '),/артикулов/);
});

test('four-column CSV is safe for spreadsheet formulas and preserves stock transfer data',()=>{
 const injection=makeInvoice('INV-F','anna',[['=HYPERLINK("bad")',1,25,'']]);
 let book=setup([injection]);book=add(book,injection,'=HYPERLINK("bad")',1,'p1');
 const report=palletStockReport(book.sessions[0],[injection],[exchange('2026-11-05',80,1)]);
 const csv=palletStockCSV(report);
 assert.equal(csv.startsWith('\ufeff'),true);
 assert.match(csv,/Название товара";"Количество, шт\.";"Цена за шт\., \$";"Цена за шт\., ₽/);
 assert.match(csv,/'=HYPERLINK/);
 assert.match(csv,/"1";"25";"2000"/);
});

test('stock table is at end of pickup recap with CSV and reads current invoice/cash without ledger writes',()=>{
 const ui=readFileSync(new URL('../js/landa-pallet-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/5\. Общий итог паллеты для «МойСклад»/);
 assert.match(ui,/palletStockReport\(s,getInvoices\(\),ops\.cash\|\|\[\]\)/);
 assert.match(ui,/plStockCSV/);
 assert.match(ui,/Количество, шт\./);
 assert.match(ui,/Цена за 1 шт\., \$/);
 assert.match(ui,/Цена за 1 шт\., ₽/);
 assert.match(ui,/Всего, \$/);
 assert.match(ui,/Всего, ₽/);
 assert.match(ui,/<th>—<\/th><th>—<\/th>/,'Total monetary values must not be displayed as unit prices');
});
