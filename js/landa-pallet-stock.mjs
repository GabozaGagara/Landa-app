// Read-only goods list for manual entry into MoySklad.
// The physical pickup journal determines quantities, current supplier invoices
// provide unit prices, and the latest recorded USD purchase provides RUB rate.
import {palletInvoiceKey,palletSummary} from './landa-pallet-core.mjs';

const normalized=value=>String(value??'').trim().toLocaleLowerCase('ru-RU');
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const round=(value,places=2)=>Math.round((value+Number.EPSILON)*10**places)/10**places;

export function palletLastPurchaseRate(cash=[]){
 const purchases=(Array.isArray(cash)?cash:[]).map((row,index)=>({row,index}))
  .filter(({row})=>row?.kind==='exchangeUSD'&&row.currency==='USD'&&Number(row.amount)>0);
 purchases.sort((a,b)=>String(a.row.date||'').localeCompare(String(b.row.date||''))||
  (Number(a.row.seq)||0)-(Number(b.row.seq)||0)||a.index-b.index);
 const recent=purchases.at(-1)?.row;
 const rate=Number(recent?.rate);
 return {rate:recent&&Number.isFinite(rate)&&rate>0?rate:null,
  date:recent?.date||null};
}

export function palletStockReport(session,invoices=[],cash=[]){
 const live=new Map((Array.isArray(invoices)?invoices:[])
  .filter(i=>i&&!i.isOpening).map(i=>[palletInvoiceKey(i),i]));
 const aggregate=new Map();
 for(const summary of palletSummary(session)){
  const source=live.get(summary.key);
  for(const product of summary.products){
   const items=(Array.isArray(source?.items)?source.items:[])
    .filter(item=>normalized(item.name)===normalized(product.name));
   const skuValues=[...new Set(items.map(item=>normalized(item.sku)))];
   const ambiguous=skuValues.length>1;
   const sku=ambiguous?'':String(items[0]?.sku||'').trim();
   const prices=items.map(item=>money(item.price));
   const samePrice=prices.length>0&&prices.every(price=>price!==null&&price===prices[0]);
   const price=!ambiguous&&samePrice?prices[0]:null;
   const key=normalized(product.name)+'\u0000'+normalized(sku);
   const row=aggregate.get(key)||{name:product.name,sku,quantity:0,knownQuantity:0,
    costCents:0,issues:new Set(),prices:new Set()};
   row.quantity+=product.places;
   if(ambiguous)row.issues.add('У товара несколько артикулов с одним названием');
   if(!source)row.issues.add('Накладная не найдена в текущей базе');
   else if(!items.length)row.issues.add('Название отсутствует в текущей накладной');
   else if(price===null)row.issues.add('Нет однозначной цены в накладной');
   if(price!==null){
    row.knownQuantity+=product.places;
    row.costCents+=Math.round(price*100)*product.places;
    row.prices.add(price);
   }
   aggregate.set(key,row);
  }
 }
 const purchase=palletLastPurchaseRate(cash);
 const rows=[...aggregate.values()].map(row=>{
  const fullyPriced=row.knownQuantity===row.quantity&&row.issues.size===0;
  const unitUsd=fullyPriced?round(row.costCents/row.quantity/100,4):null;
  const unitRub=unitUsd!==null&&purchase.rate!==null?round(unitUsd*purchase.rate,2):null;
  return {name:row.name,sku:row.sku,quantity:row.quantity,unitUsd,unitRub,
   totalUsd:fullyPriced?round(row.costCents/100):null,
   average:row.prices.size>1,issues:[...row.issues]};
 }).sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.sku.localeCompare(b.sku,'ru'));
 const missingPrices=rows.filter(row=>row.unitUsd===null).length;
 const totalUsd=missingPrices?null:round(rows.reduce((s,row)=>s+row.totalUsd,0));
 return {rows,rate:purchase.rate,rateDate:purchase.date,
  totalQuantity:rows.reduce((s,row)=>s+row.quantity,0),
  missingPrices,totalUsd,totalRub:totalUsd!==null&&purchase.rate!==null?
   round(totalUsd*purchase.rate):null};
}

export function palletStockCSV(report){
 const quote=value=>{
  let text=String(value??'');
  if(/^\s*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
 };
 const rows=[['Название товара','Количество, шт.','Цена за шт., $','Цена за шт., ₽']];
 for(const item of report.rows)rows.push([
  item.name+(item.sku?' [артикул: '+item.sku+']':''),item.quantity,
  item.unitUsd??'',item.unitRub??''
 ]);
 return '\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
}
