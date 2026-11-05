// Physical pickup journal, independent from financial invoices, cash and receiving counts.
// One journal entry = one observation on a mixed pallet; entries retain their original order.
export const PALLET_STORAGE_KEY='landa_sdek_mixed_pallet_v1';
export const palletEmpty=()=>({version:1,sessions:[]});
const safeString=(v,n)=>String(v??'').trim().slice(0,n);
const positive=(value,label,{optional=false}={})=>{
 if((value===''||value===null||value===undefined)&&optional)return null;
 const text=String(value??'').trim().replace(',','.');
 if(!/^\d+(?:\.\d{1,3})?$/.test(text))throw Error('Некорректное число: '+label);
 const num=Number(text);
 if(!Number.isFinite(num)||num<=0||num>100000)throw Error('Значение '+label+' должно быть больше нуля и не более 100000');
 return num;
};
const countPlaces=value=>{
 const v=positive(value,'мест');
 if(!Number.isSafeInteger(v))throw Error('Количество мест должно быть целым числом');
 return v;
};
export const palletInvoiceKey=invoice=>JSON.stringify([
 String(invoice?.supplierId??''),String(invoice?.id||invoice?.tracking||invoice?.number||'')
]);
export function palletShortNumber(invoice){
 const full=String(invoice?.number||invoice?.tracking||invoice?.id||'').trim(),digits=full.replace(/\D/g,'');
 return digits?digits.slice(-4):full.slice(-4)||'????';
}
export function palletInvoiceSnapshot(invoice){
 if(!invoice||invoice.isOpening||!invoice.supplierId||!(invoice.id||invoice.number||invoice.tracking))
  throw Error('Это не накладная поставщика');
 const items=(Array.isArray(invoice.items)?invoice.items:[]).slice(0,300).map(x=>({
  name:safeString(x.name,180),sku:safeString(x.sku,100),
  qty:Number.isFinite(Number(x.qty))&&Number(x.qty)>0?Number(x.qty):0
 }));
 return {key:palletInvoiceKey(invoice),supplierId:String(invoice.supplierId),
  number:safeString(invoice.number||invoice.tracking||invoice.id,120),
  tracking:safeString(invoice.tracking,120),date:safeString(invoice.date,10),
  status:safeString(invoice.status||'created',30),expectedPlaces:null,items};
}
function validSessionId(id){return typeof id==='string'&&id.length>0&&id.length<=100}
function normalizeSession(raw){
 if(!raw||!validSessionId(raw.id)||!Array.isArray(raw.invoices)||!Array.isArray(raw.entries)||
 raw.invoices.length>250||raw.entries.length>12000)throw Error('Повреждён журнал приёмки');
 const keys=new Set(),entryIds=new Set();
 const invoices=raw.invoices.map(i=>{
  const copy={key:i.key,supplierId:safeString(i.supplierId,100),number:safeString(i.number,120),
   tracking:safeString(i.tracking,120),date:safeString(i.date,10),status:safeString(i.status,30),
   expectedPlaces:i.expectedPlaces===null||i.expectedPlaces===undefined?null:countPlaces(i.expectedPlaces),
   items:(Array.isArray(i.items)?i.items:[]).slice(0,300).map(x=>({
    name:safeString(x.name,180),sku:safeString(x.sku,100),qty:Number(x.qty)||0}))};
  if(typeof i.key!=='string'||i.key.length>350||keys.has(i.key)||
     !Array.isArray(i.items)||i.items.length>300||copy.items.some(x=>!Number.isFinite(x.qty)||x.qty<0))
   throw Error('Повреждены сведения о накладных');
  keys.add(i.key);return copy;
 });
 const entries=raw.entries.map(e=>{
  if(!validSessionId(e.id)||entryIds.has(e.id)||!keys.has(e.invoiceKey))
   throw Error('В журнале отсутствует выбранная накладная или повторяется ID');
  entryIds.add(e.id);
  const product=safeString(e.product,180);
  if(!product)throw Error('В записи приёмки отсутствует товар');
  const at=safeString(e.at,45);
  if(!/^\d{4}-\d\d-\d\dT/.test(at))throw Error('Некорректная дата приёмки');
  return {id:e.id,invoiceKey:e.invoiceKey,product,places:countPlaces(e.places),
   units:positive(e.units,'штук',{optional:true}),at};
 });
 const at=safeString(raw.createdAt,45);
 if(!/^\d{4}-\d\d-\d\dT/.test(at))throw Error('Некорректная дата сессии');
 return {id:raw.id,createdAt:at,name:safeString(raw.name,110)||'Приёмка',
  closed:raw.closed===true,invoices,entries};
}
export function palletValidate(book){
 if(!book||book.version!==1||!Array.isArray(book.sessions)||book.sessions.length>250)
  throw Error('Некорректный формат архива приёмок');
 const ids=new Set();
 return {version:1,sessions:book.sessions.map(s=>{
  const session=normalizeSession(s);if(ids.has(session.id))throw Error('Повторяется ID приёмки');
  ids.add(session.id);return session;
 })};
}
const modify=(book,id,callback)=>{
 const b=palletValidate(book),index=b.sessions.findIndex(s=>s.id===id);
 if(index<0)throw Error('Приёмка не найдена');
 const s=b.sessions[index],updated=callback(s);
 b.sessions[index]=normalizeSession(updated);return b;
};
export function palletCreate(book,id,at,name){
 const b=palletValidate(book);
 if(b.sessions.length>=250||!validSessionId(id)||b.sessions.some(s=>s.id===id))throw Error('Не удалось создать приёмку');
 b.sessions.push(normalizeSession({id,createdAt:at,name:name||'Приёмка '+at.slice(0,10),
  closed:false,invoices:[],entries:[]}));
 return b;
}
export function palletSelect(book,sessionId,invoice,selected){
 return modify(book,sessionId,s=>{
  if(s.closed)throw Error('Приёмка завершена. Сначала возобновите её.');
  const info=palletInvoiceSnapshot(invoice),has=s.invoices.some(x=>x.key===info.key);
  if(selected&&!has)s.invoices.push(info);
  if(!selected&&has){
   if(s.entries.some(x=>x.invoiceKey===info.key))throw Error('По накладной уже есть записи. Удалите их перед исключением накладной.');
   s.invoices=s.invoices.filter(x=>x.key!==info.key);
  }
  return s;
 });
}
export function palletExpected(book,sessionId,invoiceKey,expectedPlaces){
 return modify(book,sessionId,s=>{
  if(s.closed)throw Error('Приёмка завершена. Сначала возобновите её.');
  const i=s.invoices.find(x=>x.key===invoiceKey);if(!i)throw Error('Накладная не выбрана');
  i.expectedPlaces=expectedPlaces===''||expectedPlaces===null?null:countPlaces(expectedPlaces);
  return s;
 });
}
export function palletAdd(book,sessionId,entry){
 return modify(book,sessionId,s=>{
  if(s.closed)throw Error('Приёмка завершена. Сначала возобновите её.');
  if(s.entries.length>=12000)throw Error('Достигнут лимит записей приёмки');
  if(!s.invoices.some(i=>i.key===entry.invoiceKey))throw Error('Сначала отметьте накладную');
  if(!validSessionId(entry.id)||s.entries.some(e=>e.id===entry.id))throw Error('Повторяется ID записи');
  const product=safeString(entry.product,180);
  if(!product)throw Error('Укажите фактический товар');
  s.entries.push({id:entry.id,invoiceKey:entry.invoiceKey,product,places:countPlaces(entry.places),
   units:positive(entry.units,'штук',{optional:true}),at:entry.at});
  return s;
 });
}
export function palletRemoveEntry(book,sessionId,id){
 return modify(book,sessionId,s=>{
  if(s.closed)throw Error('Приёмка завершена. Сначала возобновите её.');
  if(!s.entries.some(e=>e.id===id))throw Error('Запись не найдена');
  s.entries=s.entries.filter(e=>e.id!==id);return s;
 });
}
export function palletEditEntry(book,sessionId,id,{invoiceKey,product,places,units}){
 return modify(book,sessionId,s=>{
  if(s.closed)throw Error('Приёмка завершена. Сначала возобновите её.');
  if(!s.invoices.some(i=>i.key===invoiceKey))throw Error('Накладная не выбрана');
  const e=s.entries.find(e=>e.id===id);if(!e)throw Error('Запись не найдена');
  const name=safeString(product,180);if(!name)throw Error('Укажите фактический товар');
  Object.assign(e,{invoiceKey,product:name,places:countPlaces(places),units:positive(units,'штук',{optional:true})});
  return s;
 });
}
export function palletClose(book,sessionId,closed){
 return modify(book,sessionId,s=>{s.closed=!!closed;return s});
}
export function palletSummary(session){
 const s=normalizeSession(session);
 return s.invoices.map(i=>{
  const entries=s.entries.filter(e=>e.invoiceKey===i.key),groups=new Map();
  for(const e of entries){
   const key=e.product.toLocaleLowerCase('ru-RU').trim(),g=groups.get(key)||{name:e.product,places:0,entries:0,units:0};
   g.places+=e.places;g.entries++;
   // Owner's receiving rule: one recorded place is one product unit.
   // Derive quantities at read time; preserve historical e.units untouched.
   g.units+=e.places;
   groups.set(key,g);
  }
  const places=entries.reduce((x,e)=>x+e.places,0),expectedUnits=i.items.reduce((x,e)=>x+e.qty,0);
  const actual=[...groups.values()];
  const plannedNames=new Map();
  for(const item of i.items){
   const key=item.name.trim().toLocaleLowerCase('ru-RU');
   if(!key)continue;
   if(!plannedNames.has(key))plannedNames.set(key,{name:item.name,qty:0});
   plannedNames.get(key).qty+=item.qty;
  }
  const notLoaded=[...plannedNames.entries()].filter(([key])=>!groups.has(key)).map(([,v])=>v);
  const unexpected=actual.filter(g=>!plannedNames.has(g.name.toLocaleLowerCase('ru-RU').trim()));
  // The owner confirmed that the physical place count equals the actual item
  // count for this workflow. Compare it directly to supplier-declared units.
  const positionChecks=[...plannedNames.entries()].map(([key,item])=>{
   const found=groups.get(key),received=found?found.places:null;
   const delta=received===null?null:Math.round((received-item.qty)*1000)/1000;
   return {name:item.name,expected:item.qty,received,delta,
    places:found?.places||0,entries:found?.entries||0,
    state:!found?'not_loaded':delta===0?'matched':'difference'};
  });
  for(const g of unexpected)positionChecks.push({name:g.name,expected:0,
   received:g.places,delta:g.places,
   places:g.places,entries:g.entries,state:'unexpected'});
  const missingPositions=positionChecks.filter(x=>x.state==='not_loaded').length;
  const unexpectedPositions=positionChecks.filter(x=>x.state==='unexpected').length;
  const uncheckedQuantities=positionChecks.filter(x=>x.state==='unverified').length;
  const differentQuantities=positionChecks.filter(x=>x.state==='difference').length;
  return {...i,entries:entries.length,places,positions:groups.size,expectedUnits,
   actualUnits:places,
   differencePlaces:plannedNames.size?places-expectedUnits:null,
   hasManifest:plannedNames.size>0,notLoaded,unexpected,matchedPositions:plannedNames.size-notLoaded.length,
   plannedPositions:plannedNames.size,missingPositions,unexpectedPositions,
   uncheckedQuantities,differentQuantities,positionChecks,products:actual};
 });
}
export function palletSuggestions(book,invoices=[],invoiceKey='',query=''){
 const b=palletValidate(book),scores=new Map(),add=(value,score)=>{
  const name=safeString(value,180),key=name.toLocaleLowerCase('ru-RU');
  if(!name||!key)return;
  const old=scores.get(key);
  if(!old||score>old.score)scores.set(key,{name,score});
 };
 for(const s of b.sessions){
  for(const entry of s.entries)add(entry.product,10+(entry.invoiceKey===invoiceKey?15:0));
 }
 for(const i of invoices)for(const item of i.items||[])add(item.name,3+(i.key===invoiceKey?30:0));
 const q=safeString(query,100).toLocaleLowerCase('ru-RU');
 return [...scores.values()].filter(x=>!q||x.name.toLocaleLowerCase('ru-RU').includes(q))
  .sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ru')).slice(0,40).map(x=>x.name);
}
export function palletCSV(session){
 const s=normalizeSession(session),names=new Map(s.invoices.map(i=>[i.key,i]));
 const quote=v=>{
  let val=String(v??'');
  if(/^\s*[=+\-@]/.test(val))val="'"+val;
  return '"'+val.replace(/"/g,'""')+'"';
 };
 const rows=[['Приёмка','Накладная (полная)','Последние 4 цифры','Поставщик','Время записи','Фактически записано','Мест = штук товара','Исторически указано штук','ID']];
 for(const e of s.entries){
  const i=names.get(e.invoiceKey);
  rows.push([s.name,i.number,palletShortNumber(i),i.supplierId,e.at,e.product,e.places,e.units??'',e.id]);
 }
 rows.push([]);
 rows.push(['СВОДКА','Накладная','Последние 4 цифры','Поставщик','Записей','Мест / штук фактически','План штук по накладной','Разница штук','Разных позиций']);
 const report=palletSummary(s);
 for(const i of report)
  rows.push(['',i.number,palletShortNumber(i),i.supplierId,i.entries,i.places,i.expectedUnits,i.differencePlaces??'',i.positions]);
 rows.push([]);
 rows.push(['ПО ТОВАРАМ','Накладная','Последние 4 цифры','Поставщик','Товар','Мест','Штук (= мест)','Записей','В исходной накладной']);
 for(const i of report)for(const g of i.products){
  const unexpected=i.hasManifest&&i.unexpected.some(x=>x.name===g.name);
  rows.push(['',i.number,palletShortNumber(i),i.supplierId,g.name,g.places,g.units??'',g.entries,unexpected?'Нет точного совпадения':'']);
 }
 rows.push([]);
 rows.push(['АВТОСВЕРКА ПОЗИЦИЙ','Накладная','Поставщик','Товар из накладной / погрузки','Заявлено, шт.','Отмечено, шт.','Разница, шт.','Мест','Результат']);
 const states={not_loaded:'Ещё не отмечено',unverified:'Позиция есть, штуки не проверены',
  matched:'Совпадает',difference:'Расхождение по штукам',unexpected:'Нет в накладной'};
 for(const i of report)for(const p of i.positionChecks)
  rows.push(['',i.number,i.supplierId,p.name,p.expected,p.received??'',p.delta??'',p.places,states[p.state]]);
 return '\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
}
