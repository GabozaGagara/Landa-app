// Read-only validation and pure settlement preparation for owner-confirmed pallets.
// No financial state is changed here. The owner UI must explicitly confirm and save.
import {palletInvoiceKey,palletSummary,palletValidate} from './landa-pallet-core.mjs';

const cents=value=>Math.round(Number(value)*100);
const normalized=value=>String(value??'').trim().toLocaleLowerCase('ru-RU');
const accrued=i=>!!(i.isOpening||i.accrued===true||
 (i.accrued===undefined&&['received','transit'].includes(i.status)));

export function palletSettlementEligibility(summary,closed){
 const reasons=[];
 if(!closed)reasons.push('Сначала завершите приёмку');
 if(!summary?.hasManifest||!summary.plannedPositions||!(summary.expectedUnits>0))
  reasons.push('В накладной нет подтверждаемого состава товаров');
 if(!summary?.entries)reasons.push('Погрузка по накладной не записана');
 if(summary?.missingPositions)reasons.push('Не все товары из накладной отмечены');
 if(summary?.unexpectedPositions)reasons.push('В погрузке есть товары без совпадения в накладной');
 if(summary?.uncheckedQuantities||summary?.actualUnits===null)
  reasons.push('Укажите фактическое количество штук для каждой записи');
 if(summary?.differentQuantities||
  (summary?.actualUnits!==null&&Math.abs(summary.actualUnits-summary.expectedUnits)>0.000001))
  reasons.push('Количество штук отличается от накладной');
 return {ready:reasons.length===0,reasons};
}

function sameManifest(snapshot,live){
 const fingerprint=items=>(Array.isArray(items)?items:[]).map(item=>[
  normalized(item.name),normalized(item.sku),Number(item.qty)
 ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify(fingerprint(snapshot.items))===JSON.stringify(fingerprint(live.items));
}

export function preparePalletSettlement(book,operations,sessionId,invoiceKeys){
 const validated=palletValidate(book);
 const session=validated.sessions.find(s=>s.id===sessionId);
 if(!session)throw Error('Приёмка не найдена');
 if(!Array.isArray(operations?.invoices))throw Error('База накладных не загружена');
 const keys=[...new Set(invoiceKeys||[])];
 if(!keys.length||keys.length>30||keys.some(k=>typeof k!=='string'))
  throw Error('Выберите от 1 до 30 накладных для подтверждения');
 const summaries=new Map(palletSummary(session).map(v=>[v.key,v]));
 const candidates=[];
 for(const key of keys){
  const report=summaries.get(key);
  if(!report)throw Error('Выбранной накладной нет в приёмке');
  const check=palletSettlementEligibility(report,session.closed);
  if(!check.ready)throw Error('Накладная '+report.number+': '+check.reasons.join('; '));
  const original=session.invoices.find(x=>x.key===key);
  const current=operations.invoices.find(x=>!x.isOpening&&palletInvoiceKey(x)===key);
  if(!current)throw Error('Накладная '+report.number+' не найдена в текущей базе LANDA');
  if(!sameManifest(original,current))
   throw Error('Состав накладной '+report.number+' изменился после выбора в приёмку. Проверьте изменения перед начислением');
  // A pickup item has only its name, not its SKU. Two SKUs under one name
  // cannot be reconciled with confidence, even if their total happens to match.
  const variants=new Map();
  for(const item of original.items){
   const name=normalized(item.name),sku=normalized(item.sku);
   if(!variants.has(name))variants.set(name,new Set());
   variants.get(name).add(sku);
  }
  if([...variants.values()].some(skus=>skus.size>1))
   throw Error('В накладной '+report.number+' есть разные артикулы с одинаковым названием. Требуется отдельная проверка');
  if(accrued(current))throw Error('Накладная '+report.number+' уже начислена — повторное начисление запрещено');
  if(current.submittedAt&&current.reviewStatus!=='approved')
   throw Error('Накладная '+report.number+' ещё не подтверждена в Центре контроля');
  if(!Number.isFinite(current.total)||cents(current.total)<=0)
   throw Error('В накладной '+report.number+' не указана положительная стоимость');
  if(current.deliveryMissing===true||(!current.includeDelivery&&Number(current.deliveryCost)>0))
   throw Error('Уточните стоимость доставки в накладной '+report.number+' до начисления');
  if(!operations.suppliers?.some(s=>String(s.id)===String(current.supplierId)))
   throw Error('Поставщик накладной '+report.number+' не найден');
  if((operations.allocations||[]).some(a=>a.invoiceId===current.id))
   throw Error('По накладной '+report.number+' уже существуют зачёты — требуется ручная проверка');
  candidates.push({key,id:current.id,supplierId:current.supplierId,number:String(current.number||current.tracking||''),
   total:current.total,goodsCost:current.goodsCost||0,deliveryCost:current.deliveryCost||0});
 }
 return {sessionId,candidates,totalCents:candidates.reduce((sum,i)=>sum+cents(i.total),0)};
}

export function applyPalletSettlement(operations,plan,confirmedAt){
 if(!/^\d{4}-\d\d-\d\dT/.test(String(confirmedAt||'')))throw Error('Некорректное время подтверждения');
 const ids=new Set(plan.candidates.map(c=>c.id));
 if(ids.size!==plan.candidates.length)throw Error('Накладная повторяется');
 const next=structuredClone(operations);
 let count=0;
 for(const invoice of next.invoices){
  if(!ids.has(invoice.id))continue;
  if(accrued(invoice))throw Error('Накладная уже начислена');
  const previousStatus=invoice.status;
  invoice.status='delivered';
  if(previousStatus!=='delivered'&&previousStatus!=='received'){
   invoice.statusCheckedAt=confirmedAt;
   invoice.statusSource='pallet-owner-confirmed';
   invoice.trackingVerified=false;
  }
  invoice.accrued=true;
  invoice.accruedAt=confirmedAt;
  invoice.palletConfirmedAt=confirmedAt;
  invoice.palletConfirmedBy='owner';
  invoice.palletSessionId=plan.sessionId;
  count++;
 }
 if(count!==ids.size)throw Error('Не все подтверждённые накладные найдены');
 return next;
}
