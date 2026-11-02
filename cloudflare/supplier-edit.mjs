// Supplier invoice correction: pure, guarded mutation of ONLY one authorized, uncharged invoice.
// Stores the history within the private backup; never returns cross-supplier information.
const cents=x=>Math.round(Number(x||0)*100);
const text=(x,max)=>String(x??'').slice(0,max);
const ITEM_LIMIT=100;
function makeSnapshot(invoice){
 return {
  tracking:text(invoice.tracking||invoice.number,35),date:text(invoice.date,10),
  sender:text(invoice.sender,100),route:text(invoice.route,120),
  items:(Array.isArray(invoice.items)?invoice.items:[]).slice(0,ITEM_LIMIT).map(i=>({
   name:text(i.name,180),qty:Number(i.qty)||0,price:Number(i.price)||0,
   priceMissing:i.priceMissing===true,sku:text(i.sku,100)
  })),
  goodsCost:Number(invoice.goodsCost)||0,deliveryCost:Number(invoice.deliveryCost)||0,
  deliveryMissing:invoice.deliveryMissing===true,includeDelivery:!!invoice.includeDelivery,
  total:Number(invoice.total)||0,note:text(invoice.supplierNote??invoice.note,500)
 };
}
function itemDescription(item){
 return text(item.name,180)+' × '+Number(item.qty||0)+' × '+Number(item.price||0)+' $'+
   (item.priceMissing?' (цена не указана)':'')+(item.sku?' ['+text(item.sku,100)+']':'');
}
function itemsDescription(items){
 return items.map(itemDescription).join('; ').slice(0,4000);
}
const fields=[
 ['tracking','Номер СДЭК'],['date','Дата отправки'],['sender','Отправитель'],
 ['route','Маршрут'],['items','Товары'],['goodsCost','Стоимость товаров'],
 ['deliveryCost','Доставка'],['deliveryMissing','Доставка указана'],
 ['total','Общая стоимость'],['note','Комментарий']
];
export function supplierEditable(i,supplierId,allocations=[]){
 return !!(i&&i.supplierId===supplierId&&i.submittedAt&&!i.isOpening
  &&i.status!=='delivered'&&i.status!=='received'
  &&i.accrued!==true
  &&!(i.accrued===undefined&&['transit','received'].includes(i.status))
  &&!allocations.some(a=>a.invoiceId===i.id));
}
export function applySupplierEdit(ops,supplierId,invoiceId,revision,normalized,now,eventId){
 if(!ops||!Array.isArray(ops.invoices)||!Array.isArray(ops.allocations))throw Object.assign(Error('Некорректная база'),{code:502});
 if(typeof invoiceId!=='string'||invoiceId.length>160)throw Object.assign(Error('Неверный идентификатор накладной'),{code:400});
 const current=ops.invoices.find(i=>i.id===invoiceId&&i.supplierId===supplierId);
 if(!current)throw Object.assign(Error('Накладная не найдена или не принадлежит поставщику'),{code:404});
 if(!supplierEditable(current,supplierId,ops.allocations))
  throw Object.assign(Error('Редактирование запрещено: накладная вручена, начислена к оплате или уже имеет зачёты. Обратитесь к владельцу LANDA.'),{code:403});
 if(!Number.isSafeInteger(revision)||revision<0||revision!==Number(current.supplierEditRevision||0))
  throw Object.assign(Error('Накладная уже изменилась. Обновите список и повторите исправление.'),{code:409});
 if(normalized.supplierId!==supplierId)throw Object.assign(Error('Нельзя исправлять накладную другого поставщика'),{code:403});
 const wanted=String(normalized.tracking||'').toLowerCase();
 if(ops.invoices.some(x=>x.id!==current.id&&[x.number,x.tracking].some(v=>String(v||'').trim().toLowerCase()===wanted)))
  throw Object.assign(Error('Накладная с таким номером СДЭК уже существует'),{code:409});
 const before=makeSnapshot(current);
 const newValues={
  tracking:normalized.tracking,number:normalized.tracking,date:normalized.date,
  sender:normalized.sender,route:'Брест → '+normalized.destination,
  items:normalized.items,goodsCost:normalized.goodsCost,deliveryCost:normalized.deliveryCost,
  deliveryMissing:normalized.deliveryMissing,includeDelivery:true,
  total:Math.round(cents(normalized.goodsCost)+cents(normalized.deliveryCost))/100,
  supplierNote:normalized.note
 };
 const after=makeSnapshot({...current,...newValues});
 const changes=fields.flatMap(([key,label])=>{
  if(JSON.stringify(before[key])===JSON.stringify(after[key]))return [];
  const readable=v=>key==='items'?itemsDescription(v):key==='deliveryMissing'?(v?'не указана':'указана'):String(v);
  return [{field:key,label,before:readable(before[key]),after:readable(after[key])}];
 });
 if(!changes.length)return {updated:false,invoiceId,revision:current.supplierEditRevision||0};
 const history=(Array.isArray(current.supplierEditHistory)?current.supplierEditHistory:[]).slice(-19);
 const event={at:now,by:'supplier:'+supplierId,changes};
 const newHistory=[...history,event];
 // This state is private and not writable from the supplier body.
 Object.assign(current,newValues,{
  supplierEditedAt:now,supplierEditedBy:supplierId,
  supplierEditRevision:Number(current.supplierEditRevision||0)+1,
  supplierEditHistory:newHistory,
  reviewStatus:'pending'
 });
 // Preserve owner's original submission and shipment status; force re-approval.
 if(!Array.isArray(ops.auditTrail))ops.auditTrail=[];
 ops.auditTrail.push({id:eventId,at:now,type:'supplier_edit',recordId:current.id,
  source:'supplier:'+supplierId,
  summary:'Поставщик '+supplierId+' изменил накладную '+current.number+': '+changes.map(c=>c.label).join(', ').slice(0,250)});
 ops.auditTrail=ops.auditTrail.slice(-900);
 return {updated:true,invoiceId,revision:current.supplierEditRevision,editedAt:now,changedFields:changes.map(c=>c.label)};
}
