// Conservative conflict-aware merge of two LANDA financial backups.
// Independent invoice/payment/cash/sale records and separate calculation cells
// may converge automatically. Competing edits to the same amount stop syncing.
import {mergeRecords} from './landa-record-merge.mjs';

const arrays={
 'proschet.rows':'id',
 'proschet.groups':'id',
 'proschet.snapshots':'id',
 'proschet.auditTrail':'id',
 'operations.suppliers':'id',
 'operations.invoices':'id',
 'operations.payments':'id',
 'operations.allocations':'id',
 'operations.reservedAdvances':'id',
 'operations.cash':'id',
 'operations.sales':'id',
 'operations.auditTrail':'id'
};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const copy=x=>JSON.parse(JSON.stringify(x));
const positive=x=>Number.isFinite(Number(x))&&Number(x)>=0;

function verifyAccounting(ops){
 const invoices=new Map((ops.invoices||[]).map(i=>[String(i.id),i]));
 const payments=new Map((ops.payments||[]).map(p=>[String(p.id),p]));
 const invoicePaid=new Map(),paymentUsed=new Map();
 for(const a of ops.allocations||[]){
  const amount=Number(a.amount);
  if(!positive(amount)||!invoices.has(String(a.invoiceId))||!payments.has(String(a.paymentId)))
   return 'Ссылка или сумма зачёта платежа требует проверки';
  if(invoices.get(String(a.invoiceId)).supplierId!==payments.get(String(a.paymentId)).supplierId)
   return 'Зачёт платежа относится к другому поставщику';
  invoicePaid.set(String(a.invoiceId),(invoicePaid.get(String(a.invoiceId))||0)+Math.round(amount*100));
  paymentUsed.set(String(a.paymentId),(paymentUsed.get(String(a.paymentId))||0)+Math.round(amount*100));
 }
 for(const [id,cents] of invoicePaid){
  if(cents>Math.round(Number(invoices.get(id).total)*100))return 'Зачёты превышают стоимость накладной '+id;
 }
 const reservedUsed=new Map();
 for(const r of ops.reservedAdvances||[]){
  const payment=payments.get(String(r.paymentId));
  if(!payment||payment.supplierId!==r.supplierId)return 'Отложенный аванс не связан с правильным переводом';
  if(!Number.isFinite(r.amount)||r.amount<=0||!String(r.purpose||'').trim()||
   !Number.isFinite(Number(r.releasedAmount||0))||Number(r.releasedAmount||0)<0||
   Number(r.releasedAmount||0)>r.amount)
   return 'Некорректная сумма отложенного аванса';
  const reserved=Math.round(r.amount*100)-Math.round(Number(r.releasedAmount||0)*100);
  reservedUsed.set(String(r.paymentId),(reservedUsed.get(String(r.paymentId))||0)+reserved);
 }
 for(const [id,payment] of payments){
  if((paymentUsed.get(id)||0)+(reservedUsed.get(id)||0)>Math.round(Number(payment.amount)*100))
   return 'Перевод '+id+' распределён или отложен на сумму больше фактического перевода';
 }
 const shipments=new Set();
 for(const i of ops.invoices||[]){
  if(i.isOpening)continue;
  const number=String(i.tracking||i.number||'').replace(/\s/g,'').toLowerCase();
  if(!number)continue;
  if(shipments.has(number))return 'Две накладные имеют одинаковый номер '+number;
  shipments.add(number);
 }
 const soldBySource=new Map();
 for(const sale of ops.sales||[]){
  if(!sale.source)continue;
  soldBySource.set(sale.source,(soldBySource.get(sale.source)||0)+Number(sale.qty||0));
 }
 for(const [source,sold] of soldBySource){
  const pos=source.lastIndexOf(':');if(pos<0)continue;
  let invoiceId;try{invoiceId=decodeURIComponent(source.slice(0,pos))}catch(_){continue}
  const index=Number(source.slice(pos+1)),items=invoices.get(invoiceId)?.items;
  if(!Array.isArray(items)||!Number.isSafeInteger(index)||index<0||!items[index])continue;
  if(sold>Number(items[index].qty)+0.000001)return 'Продажи превысили остаток товара по накладной '+invoiceId;
 }
 return null;
}

export function mergeFinanceBackups(base,local,remote){
 for(const doc of [base,local,remote]){
  if(!doc||doc.app!=='LANDA-suite'||![2,3].includes(doc.backupVersion)||
   !doc.proschet||!doc.operations)return {merged:null,conflicts:['Неподдерживаемая финансовая копия']};
 }
 const clean=doc=>{
  const d=copy(doc);
  delete d.createdAt; // Backup creation timestamp is not accounting data.
  delete d.operations.nextSeq; // A counter; unique IDs are checked separately.
  return d;
 };
 const outcome=mergeRecords(clean(base),clean(local),clean(remote),{arrayIds:arrays});
 if(outcome.conflicts.length)return outcome;
 const merged=outcome.merged;
 merged.createdAt=new Date().toISOString();
 merged.backupVersion=3;
 merged.operations.nextSeq=Math.max(0,...[base,local,remote].map(d=>Number(d.operations.nextSeq)||0));
 const financialProblem=verifyAccounting(merged.operations);
 if(financialProblem)return {merged:null,conflicts:[financialProblem]};
 // Never claim a merge succeeded if an unhandled top-level field disappeared.
 if(!same(Object.keys(merged.proschet).sort(),Object.keys({...base.proschet,...local.proschet,...remote.proschet}).sort())||
  !same(Object.keys(merged.operations).sort(),Object.keys({...base.operations,...local.operations,...remote.operations}).sort()))
  return {merged:null,conflicts:['Не все разделы финансовой базы удалось объединить']};
 return {merged,conflicts:[]};
}
