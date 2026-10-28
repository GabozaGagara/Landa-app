// Supplier-scoped read-only projection: never return the private database.
const CDEK_STATUS={created:'Создан',transit:'В пути',ready:'Готов к выдаче',delivered:'Вручен'};
const cents=n=>Math.round((Number.isFinite(Number(n))?Number(n):0)*100);
const money=n=>Math.round(n)/100;
const accrued=i=>!!(i.isOpening||i.accrued===true||(i.accrued===undefined&&['received','transit'].includes(i.status)));
export function supplierOverview(backup,supplierId,page=1){
 if(!['anna','alina','anatoly'].includes(supplierId))throw Error('Неизвестный поставщик');
 const ops=backup?.operations;
 if(!ops||!Array.isArray(ops.invoices)||!Array.isArray(ops.payments)||!Array.isArray(ops.allocations))throw Error('Неверный формат базы LANDA');
 if(!Number.isSafeInteger(page)||page<1||page>10000)throw Error('Неверная страница');
 const invoices=ops.invoices.filter(i=>i.supplierId===supplierId);
 const payments=ops.payments.filter(p=>p.supplierId===supplierId);
 const ids=new Set(invoices.map(i=>i.id));
 const paymentIds=new Set(payments.map(p=>p.id));
 const alloc=ops.allocations.filter(a=>ids.has(a.invoiceId)&&paymentIds.has(a.paymentId));
 const allPaidCents=payments.reduce((s,p)=>s+cents(p.amount),0);
 const allBilledCents=invoices.reduce((s,i)=>s+(accrued(i)?cents(i.total):0),0);
 const allocatedCents=alloc.reduce((s,a)=>s+cents(a.amount),0);
 const notAccrued=invoices.filter(i=>!i.isOpening&&!accrued(i));
 const listed=invoices.filter(i=>!i.isOpening).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||(Number(b.seq||0)-Number(a.seq||0)));
 const perPage=30,from=(page-1)*perPage;
 const names={anna:'Анна',alina:'Алина',anatoly:'Анатолий'};
 return {
  supplier:{id:supplierId,name:names[supplierId]},
  summary:{balance:money(allPaidCents-allBilledCents),paid:money(allPaidCents),accrued:money(allBilledCents),allocated:money(allocatedCents),open:money(allBilledCents-allocatedCents),advance:money(allPaidCents-allocatedCents),pendingAmount:money(notAccrued.reduce((s,i)=>s+cents(i.total),0)),pendingCount:notAccrued.length,count:listed.length},
  pagination:{page,pageSize:perPage,total:listed.length,pages:Math.ceil(listed.length/perPage)},
  invoices:listed.slice(from,from+perPage).map(i=>{
   const paid=alloc.filter(a=>a.invoiceId===i.id).reduce((s,a)=>s+cents(a.amount),0);
   const charge=accrued(i);
   const status=i.status==='received'?'delivered':(CDEK_STATUS[i.status]?i.status:'created');
   return {
    number:String(i.number||'').slice(0,100),tracking:String(i.tracking||'').slice(0,100),date:String(i.date||'').slice(0,20),
    status,statusLabel:CDEK_STATUS[status],trackingVerified:i.trackingVerified===true,accrued:charge,
    items:(Array.isArray(i.items)?i.items:[]).slice(0,100).map(x=>({name:String(x.name||'').slice(0,180),qty:Number(x.qty)||0,price:Number(x.price)||0,sku:String(x.sku||'').slice(0,100)})),
    goodsCost:Number.isFinite(i.goodsCost)?i.goodsCost:(Number(i.total)||0),deliveryCost:Number(i.deliveryCost)||0,includeDelivery:!!i.includeDelivery,
    total:Number(i.total)||0,allocated:money(paid),due:charge?money(Math.max(0,cents(i.total)-paid)):0
   };
  }),
  fetchedAt:new Date().toISOString()
 };
}
