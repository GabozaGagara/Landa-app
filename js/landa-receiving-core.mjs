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
  const invoiceId=String(inv.id||inv.tracking||inv.number||[inv.supplierId,inv.date].join(':'));
  items.forEach((item,index)=>{
   const name=String(item?.name??'').trim(),sku=String(item?.sku??'').trim();
   const row={
    key:JSON.stringify([invoiceId,index,name,sku,number(item?.qty)]),
    invoiceId,supplierId:String(inv.supplierId??''),
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

// Stable product identity is independent of invoice, price and quantity.
// Mappings affect only how the read-only reconciliation summary is displayed.
export const productIdentity = row => JSON.stringify([
 String(row?.supplierId??''),normalized(row?.sku),normalized(row?.name)
]);

const aliasName = value => String(value??'').trim().slice(0,180);
export function safeProductAliases(input){
 const clean={version:1,groups:[]},seen=new Set(),ids=new Set();
 if(!input||input.version!==1||!Array.isArray(input.groups)||input.groups.length>500)return clean;
 for(const group of input.groups){
  if(!group||typeof group.id!=='string'||!group.id||group.id.length>100||ids.has(group.id)||
     typeof group.name!=='string'||!aliasName(group.name)||
     !Array.isArray(group.members)||group.members.length<2||group.members.length>200)continue;
  const members=[];
  for(const key of group.members){
   if(typeof key!=='string'||key.length>550||seen.has(key)||members.includes(key))continue;
   try{
    const parsed=JSON.parse(key);
    if(!Array.isArray(parsed)||parsed.length!==3||parsed.some(x=>typeof x!=='string'||x.length>180))continue;
   }catch(_){continue}
   members.push(key);
  }
  if(members.length<2)continue;
  ids.add(group.id);members.forEach(k=>seen.add(k));
  clean.groups.push({id:group.id,name:aliasName(group.name),members});
 }
 return clean;
}
export function mergeProductAliases(input,selections,name,id){
 const aliases=safeProductAliases(input),label=aliasName(name);
 if(!label||!Array.isArray(selections)||selections.length<2||selections.length>150||
    typeof id!=='string'||!id||id.length>100)throw new Error('Укажите название и выберите хотя бы две позиции.');
 const selected=new Set();
 for(const group of selections){
  if(!group||!Array.isArray(group.members))throw new Error('Обновите сводку и попробуйте ещё раз.');
  for(const key of group.members)selected.add(key);
 }
 // Full member sets are provided for existing merged groups, even under filters.
 for(const g of aliases.groups)if(g.members.some(k=>selected.has(k)))g.members.forEach(k=>selected.add(k));
 if(selected.size<2||selected.size>200)throw new Error('Для объединения выберите от 2 до 200 разных товаров.');
 const next={version:1,groups:aliases.groups.filter(g=>!g.members.some(k=>selected.has(k)))};
 if(next.groups.some(g=>g.id===id))throw new Error('Повторный ID объединения.');
 next.groups.push({id,name:label,members:[...selected]});
 return safeProductAliases(next);
}
export function unmergeProductAliases(input,id){
 const aliases=safeProductAliases(input);
 return {version:1,groups:aliases.groups.filter(g=>g.id!==id)};
}
export function renameProductAlias(input,id,name){
 const aliases=safeProductAliases(input),label=aliasName(name);
 if(!label)throw new Error('Укажите название общего товара.');
 const group=aliases.groups.find(g=>g.id===id);
 if(!group)throw new Error('Объединение не найдено.');
 group.name=label;return aliases;
}
export function aggregateProducts(rows,counts={},aliases={version:1,groups:[]}) {
 const associations=new Map(),aliasMap=new Map();
 for(const g of safeProductAliases(aliases).groups)for(const key of g.members)aliasMap.set(key,g);
 const groups=new Map();
 for(const row of rows) {
  const sourceKey=productIdentity(row),rule=aliasMap.get(sourceKey);
  const key=rule?'merged:'+rule.id:sourceKey;
  if(!groups.has(key))groups.set(key,{
   key,aliasId:rule?.id||null,merged:!!rule,
   supplierId:row.supplierId,sku:row.sku,name:rule?.name||row.name,
   expected:0,received:0,done:0,lines:0,invoices:new Set(),
   members:rule?[...rule.members]:[sourceKey],suppliers:new Set(),variants:new Map(),skus:new Set()
  });
  const g=groups.get(key),comparison=compareCount(row,counts[row.key]);
  g.expected=round(g.expected+row.qty);g.lines++;
  g.invoices.add(JSON.stringify([row.supplierId,row.invoiceId]));
  g.suppliers.add(row.supplierId);if(row.sku)g.skus.add(row.sku);
  if(!g.variants.has(sourceKey))g.variants.set(sourceKey,{supplierId:row.supplierId,name:row.name,sku:row.sku,key:sourceKey,lines:0});
  g.variants.get(sourceKey).lines++;
  if(comparison.state==='matched'||comparison.state==='difference'){g.received=round(g.received+comparison.received);g.done++}
 }
 return Array.from(groups.values()).map(g=>({
  ...g,invoices:Array.from(g.invoices),suppliers:Array.from(g.suppliers),
  variants:Array.from(g.variants.values()),skus:Array.from(g.skus),
  received:g.done===g.lines?g.received:null,
  delta:g.done===g.lines?round(g.received-g.expected):null
 })).sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.supplierId.localeCompare(b.supplierId));
}

export function csvCell(value){
 let v=String(value??'');
 if(typeof value==='string' && /^[\s]*[=+\-@]/.test(v))v="'"+v;
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
