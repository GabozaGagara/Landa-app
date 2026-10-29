// Pure reconciliation helpers. They do not read or write LANDA financial data.
const number = x => Number(x);
const normalized = x => String(x ?? '').trim().toLocaleLowerCase('ru-RU');
const round = x => Math.round(x * 10000) / 10000;

export function collectShipmentRows(invoices, filters = {}) {
 const {supplier='all', onlyPortal=false, search=''} = filters;
 const query=normalized(search);
 const rows=[];
 for(const inv of (Array.isArray(invoices)?invoices:[])) {
  if(!inv || inv.isOpening || (onlyPortal&&!inv.submittedAt))continue;
  if(supplier!=='all' && inv.supplierId!==supplier)continue;
  const items=Array.isArray(inv.items)?inv.items:[];
  items.forEach((item,index)=>{
   const name=String(item?.name??'').trim(),sku=String(item?.sku??'').trim();
   const row={
    key:JSON.stringify([String(inv.id??''),index,name,sku,number(item?.qty)]),
    invoiceId:String(inv.id??''),supplierId:String(inv.supplierId??''),
    invoice:String(inv.number||inv.tracking||inv.id||''),
    tracking:String(inv.tracking||''),date:String(inv.date||'').slice(0,10),
    status:String(inv.status||'created'),submittedAt:String(inv.submittedAt||''),
    reviewStatus:String(inv.reviewStatus||''),
    itemIndex:index,name,sku,qty:number(item?.qty),price:number(item?.price)
   };
   if(!Number.isFinite(row.qty)||row.qty<0)row.qty=0;
   if(!Number.isFinite(row.price)||row.price<0)row.price=0;
   if(query&&!normalized([row.name,row.sku,row.invoice,row.tracking,row.supplierId].join(' ')).includes(query))return;
   rows.push(row);
  });
 }
 return rows.sort((a,b)=>b.date.localeCompare(a.date)||a.supplierId.localeCompare(b.supplierId)||a.invoice.localeCompare(b.invoice)||a.itemIndex-b.itemIndex);
}

export function compareCount(row,record) {
 const raw=record?.received;
 if(raw===undefined || raw===null || raw==='')return {state:'pending',received:null,delta:null};
 const received=number(raw);
 if(!Number.isFinite(received)||received<0)return {state:'invalid',received:null,delta:null};
 const delta=round(received-row.qty);
 return {state:Math.abs(delta)<0.000001?'matched':'difference',received,delta};
}

export function aggregateProducts(rows,counts={}) {
 const groups=new Map();
 for(const row of rows) {
  // Keep supplier, SKU and product description separate to prevent false matches.
  const key=JSON.stringify([row.supplierId,normalized(row.sku),normalized(row.name)]);
  if(!groups.has(key))groups.set(key,{key,supplierId:row.supplierId,sku:row.sku,name:row.name,expected:0,received:0,done:0,lines:0,invoices:new Set()});
  const g=groups.get(key),comparison=compareCount(row,counts[row.key]);
  g.expected=round(g.expected+row.qty);g.lines++;g.invoices.add(row.invoice);
  if(comparison.state==='matched'||comparison.state==='difference'){g.received=round(g.received+comparison.received);g.done++}
 }
 return Array.from(groups.values()).map(g=>({
  ...g,invoices:Array.from(g.invoices),
  received:g.done===g.lines?g.received:null,
  delta:g.done===g.lines?round(g.received-g.expected):null
 })).sort((a,b)=>a.supplierId.localeCompare(b.supplierId)||a.name.localeCompare(b.name,'ru'));
}

export function csvCell(value){
 let v=String(value??'');
 if(/^[\s]*[=+\-@]/.test(v))v="'"+v;
 return '"'+v.replace(/"/g,'""')+'"';
}
export function receiptCSV(rows,counts={},supplierNames={}) {
 const header=['Поставщик','Дата','Накладная','СДЭК','Товар','Артикул','Заявлено, шт.','Учтено вручную, шт.','Разница, шт.','Результат','Комментарий'];
 const data=rows.map(row=>{
  const comparison=compareCount(row,counts[row.key]);
  const labels={pending:'Не сверено',matched:'Совпадает',difference:'Расхождение',invalid:'Некорректное количество'};
  return [supplierNames[row.supplierId]||row.supplierId,row.date,row.invoice,row.tracking,row.name,row.sku,
   row.qty,comparison.received??'',comparison.delta??'',labels[comparison.state],counts[row.key]?.note||''];
 });
 return '\ufeff'+[header,...data].map(row=>row.map(csvCell).join(';')).join('\r\n');
}
