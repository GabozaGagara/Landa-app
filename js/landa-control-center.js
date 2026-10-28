/* LANDA: additive operational controls. Does not alter cash, old invoices, or cloud credentials. */
(function(){
'use strict';
if(typeof ops==='undefined'||typeof state==='undefined'||typeof saveOps!=='function')return;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const cents=n=>Math.round((Number(n)||0)*100),usd=n=>(Math.round(n)/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' $';
const rub=n=>(Math.round(n)/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
const amount=n=>Math.round(n)/100;
const iso=()=>new Date().toISOString(),today=()=>iso().slice(0,10);
const charged=i=>!!(i.isOpening||i.accrued===true||(i.accrued===undefined&&['received','transit'].includes(i.status)));
const supplierName=id=>(ops.suppliers.find(s=>s.id===id)||{}).name||id;
const approval=i=>!i.submittedAt||i.reviewStatus==='approved';
const labels={created:'Создан',transit:'В пути',ready:'Готов к выдаче',delivered:'Вручен',received:'Вручен'};
const style=document.createElement('style');
style.textContent=[
'.lc-shell{background:#fff;border:1px solid #dbe5f1;border-radius:16px;padding:17px;margin:13px 0 20px}',
'.lc-shell h2{font-size:19px;margin:0 0 6px;color:#1a2f50}',
'.lc-desc{font-size:12px;color:#64758a;margin:0 0 14px}',
'.lc-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:12px 0}',
'.lc-metric{border:1px solid #e4ebf4;background:#f8fbff;border-radius:12px;padding:12px}',
'.lc-metric small{display:block;font-size:11px;color:#64758a}.lc-metric b{font-size:21px;color:#1a2f50}',
'.lc-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}',
'.lc-btn{border:1px solid #cbd8e9;border-radius:9px;background:#fff;padding:8px 11px;cursor:pointer;color:#26446c;font-weight:600}',
'.lc-btn.primary{background:#2853c8;color:white;border-color:#2853c8}.lc-btn:disabled{opacity:.5}',
'.lc-panel{border:1px solid #e4ebf4;border-radius:11px;padding:12px;margin:10px 0}',
'.lc-row{display:flex;gap:10px;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #edf1f6;flex-wrap:wrap}',
'.lc-row:last-child{border:0}.lc-row p{font-size:12px;color:#6b7890;margin:3px 0}',
'.lc-warning{background:#fff8ee;border-left:3px solid #d7a047;padding:10px;margin:8px 0;border-radius:5px;font-size:13px}',
'.lc-good{color:#16775f}.lc-muted{color:#78869b;font-size:12px}',
'.lc-inline{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:10px 0}',
'.lc-inline label{display:flex;flex-direction:column;gap:4px;font-size:12px;min-width:105px;flex:1}',
'.lc-inline input,.lc-inline select{padding:8px;border:1px solid #ccd6e2;border-radius:8px;min-width:0;width:100%;font:inherit}',
'.lc-list{max-height:290px;overflow:auto}.lc-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}',
'.lc-pills{font-size:12px;background:#edf4ff;border-radius:9px;padding:3px 8px;display:inline-block;margin:3px 3px 3px 0}',
'@media print{body>*:not(.lc-print-only){display:none!important}.lc-print-only{display:block!important;position:absolute;inset:0;background:#fff;padding:20px}}'
].join('');
document.head.appendChild(style);
const dashboard=$('dashboardKpis');
if(!dashboard)return;
const center=document.createElement('section');
center.className='lc-shell';
center.id='landaControlCenter';
center.innerHTML=[
'<div class="lc-head"><div><h2>Центр контроля LANDA</h2><p class="lc-desc">Проверки финансов, приёмка накладных, история и сверка. Ни одно действие здесь не начисляет долг автоматически.</p></div>',
'<button class="lc-btn" id="lcRefresh" type="button">↻ Обновить контроль</button></div>',
'<div id="lcMetrics" class="lc-metrics"></div><div id="lcWarnings"></div>',
'<div class="lc-panel"><div class="lc-head"><h3>Проверка накладных поставщиков</h3><span class="lc-muted">Новые поставки не увеличивают долг до начисления</span></div><div id="lcReview"></div></div>',
'<details class="lc-panel"><summary><b>Акт сверки с поставщиком</b> — скачать CSV или печатать в PDF</summary>',
'<div class="lc-inline"><label>Поставщик<select id="lcStatementSupplier"></select></label><label>С<input type="date" id="lcFrom"></label><label>По<input type="date" id="lcTo"></label></div>',
'<div class="lc-actions"><button type="button" class="lc-btn primary" id="lcStatementBuild">Рассчитать</button><button type="button" class="lc-btn" id="lcStatementCSV">Скачать CSV</button><button type="button" class="lc-btn" id="lcStatementPrint">Печать / PDF</button></div>',
'<div id="lcStatementPreview" class="lc-muted">Выберите период и нажмите «Рассчитать».</div></details>',
'<details class="lc-panel"><summary><b>Продажи и прибыль по товарам</b> — справочный журнал</summary>',
'<p class="lc-desc">Продажи не записываются в кассу автоматически. Для прибыли цена продажи и расходы в ₽; закупка в $ пересчитывается по указанному фактическому курсу.</p>',
'<form id="lcSaleForm"><div class="lc-inline">',
'<label>Дата<input type="date" name="date" required></label>',
'<label>Источник товара<select name="source" id="lcSaleSource"></select></label>',
'<label>Товар<input name="item" maxlength="180" required placeholder="Название"></label>',
'<label>Канал<select name="channel"><option>Авито</option><option>Магазин</option><option>Маркетплейс</option><option>Другое</option></select></label>',
'<label>Кол-во<input name="qty" type="number" min="0.01" step="any" value="1" required></label>',
'<label>Закупка, $/шт<input name="costUsd" type="number" min="0" step=".01" required></label>',
'<label>Курс ₽/$<input name="rate" type="number" min=".01" step=".01" required></label>',
'<label>Цена продажи, ₽/шт<input name="saleRub" type="number" min="0" step=".01" required></label>',
'<label>Комиссии, ₽<input name="feesRub" type="number" min="0" step=".01" value="0" required></label>',
'<label>Доставка и прочие, ₽<input name="deliveryRub" type="number" min="0" step=".01" value="0" required></label>',
'</div><button type="submit" class="lc-btn primary">Записать продажу</button></form>',
'<div id="lcSalesSummary" class="lc-metrics"></div><div id="lcSalesRows" class="lc-list"></div></details>',
'<details class="lc-panel"><summary><b>Журнал действий</b> — последние изменения с момента подключения</summary><div id="lcAudit" class="lc-list"></div></details>',
'<details class="lc-panel"><summary><b>Резервные версии на этом устройстве</b></summary>',
'<p class="lc-desc">Автоматические версии хранятся отдельно в IndexedDB этого браузера. Для защиты от потери устройства регулярно скачивайте полную JSON-копию.</p>',
'<div class="lc-actions"><button type="button" class="lc-btn" id="lcMakeBackup">Сохранить версию сейчас</button><button type="button" class="lc-btn" id="lcListBackups">Обновить список</button></div>',
'<div id="lcBackupStatus" class="lc-muted"></div><div id="lcBackups" class="lc-list"></div></details>'
].join('');
dashboard.insertAdjacentElement('afterend',center);
const cs={};
let previousOps=JSON.parse(JSON.stringify(ops));
const auditRecord=(type,id,label,source='owner')=>({id:'evt-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9),at:iso(),type,recordId:String(id||''),summary:String(label||'').slice(0,250),source});
function diffOps(before,after){
 const events=[],types={invoices:'Накладная',payments:'Оплата',allocations:'Зачёт',cash:'Касса',sales:'Продажа'};
 for(const [key,tag] of Object.entries(types)){
  const pre=new Map((before[key]||[]).map(v=>[v.id,v]));
  const post=new Map((after[key]||[]).map(v=>[v.id,v]));
  for(const [id,n] of post){
   const o=pre.get(id);
   if(!o){events.push(auditRecord('created',id,tag+' добавлена'+(n.number?' №'+n.number:'')));continue}
   if(JSON.stringify(o)===JSON.stringify(n))continue;
   if(key==='invoices'){
    if(o.status!==n.status)events.push(auditRecord('status',id,'Статус накладной '+(n.number||'')+': '+(labels[o.status]||o.status)+' → '+(labels[n.status]||n.status)));
    if(charged(o)!==charged(n))events.push(auditRecord('accrual',id,'Начисление '+(n.number||'')+': '+(charged(n)?'включено':'отменено')));
    if(o.reviewStatus!==n.reviewStatus)events.push(auditRecord('review',id,'Проверка '+(n.number||'')+': '+(n.reviewStatus||'ожидает')));
    if(cents(o.total)!==cents(n.total))events.push(auditRecord('amount',id,'Изменена сумма накладной '+(n.number||'')+': '+usd(cents(o.total))+' → '+usd(cents(n.total))));
    if(!events.some(e=>e.recordId===id))events.push(auditRecord('changed',id,'Накладная '+(n.number||'')+' изменена'));
   }else events.push(auditRecord('changed',id,tag+' изменена'));
  }
  for(const [id,o] of pre)if(!post.has(id))events.push(auditRecord('removed',id,tag+' удалена'+(o.number?' №'+o.number:'')));
 }
 if(JSON.stringify(before.openings)!==JSON.stringify(after.openings))events.push(auditRecord('opening','accounts','Изменены начальные остатки счетов'));
 return events.slice(0,120);
}
const savedOps=saveOps;
saveOps=function(){
 const oldAudit=Array.isArray(ops.auditTrail)?ops.auditTrail:[];
 const entries=diffOps(previousOps,ops);
 if(entries.length)ops.auditTrail=oldAudit.concat(entries).slice(-900);
 const ok=savedOps();
 if(ok)previousOps=JSON.parse(JSON.stringify(ops));
 return ok;
};
function getIssues(){
 const errors=[],invIds=new Set(ops.invoices.map(x=>x.id)),payIds=new Set(ops.payments.map(x=>x.id));
 const tracks=new Set();
 for(const i of ops.invoices){
  const t=String(i.tracking||'').replace(/\s/g,'').toLowerCase();
  if(t){if(tracks.has(t))errors.push('Дублирующийся номер СДЭК: '+t);tracks.add(t)}
  const items=Array.isArray(i.items)?i.items:[];
  if(!i.isOpening&&items.length&&items.every(x=>Number.isFinite(Number(x.price)))&&Math.abs(cents(i.goodsCost)-items.reduce((s,x)=>s+cents((Number(x.qty)||0)*(Number(x.price)||0)),0))>2)errors.push('Сумма товаров не совпадает с позициями: '+(i.number||i.id));
  const allocated=(ops.allocations||[]).filter(a=>a.invoiceId===i.id).reduce((s,a)=>s+cents(a.amount),0);
  if(allocated>cents(i.total))errors.push('Переплата сверх суммы накладной: '+(i.number||i.id));
  if(allocated&&!charged(i))errors.push('Зачёт на неначисленную накладную: '+(i.number||i.id));
 }
 for(const p of ops.payments){
  const allocated=ops.allocations.filter(a=>a.paymentId===p.id).reduce((s,a)=>s+cents(a.amount),0);
  if(allocated>cents(p.amount))errors.push('Зачёт больше суммы платежа: '+(p.id||''));
 }
 for(const a of ops.allocations)if(!invIds.has(a.invoiceId)||!payIds.has(a.paymentId))errors.push('Распределение с отсутствующей накладной или оплатой');
 return errors.slice(0,40);
}
function renderMetrics(){
 const invoices=ops.invoices.filter(i=>!i.isOpening);
 const pending=invoices.filter(i=>!charged(i));
 const review=invoices.filter(i=>i.submittedAt&&!approval(i));
 const deliveredUnbilled=invoices.filter(i=>(i.status==='delivered'||i.status==='received')&&!charged(i));
 const unchecked=invoices.filter(i=>i.tracking&&i.status!=='delivered'&&i.status!=='received'&&(!i.statusCheckedAt||Date.now()-Date.parse(i.statusCheckedAt)>7*86400000));
 const sum=pending.reduce((s,i)=>s+cents(i.total),0);
 const issues=getIssues();
 $('lcMetrics').innerHTML=[
  ['Поставки без начисления',usd(sum),'Не начисленный долг, '+pending.length+' накл.'],
  ['Ожидают проверки',String(review.length),'Необходимо решение владельца'],
  ['Не проверяли СДЭК >7 дней',String(unchecked.length),'Включая статусы без даты проверки'],
  ['Проблемы учёта',String(issues.length),'Проверки сумм и связей']
 ].map(x=>'<div class="lc-metric"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b><small>'+esc(x[2])+'</small></div>').join('');
 const warnings=[];
 if(review.length)warnings.push('Поставщики отправили '+review.length+' накладных, которые ещё не подтверждены владельцем.');
 if(deliveredUnbilled.length)warnings.push('Вручены, но не начислены: '+deliveredUnbilled.length+'. Перед начислением проверь стоимость и товары.');
 if(issues.length)warnings.push(...issues.slice(0,8));
 const gh=$('ghMessage')?.textContent||'';
 if(/конфликт|не синхрониз|отключён|различают|ошибка/i.test(gh))warnings.push('GitHub: '+gh.slice(0,200));
 $('lcWarnings').innerHTML=warnings.length?warnings.map(x=>'<p class="lc-warning">⚠ '+esc(x)+'</p>').join(''):'<p class="lc-muted lc-good">✓ По доступным данным дополнительных предупреждений нет.</p>';
 $('lcReview').innerHTML=review.length?review.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).map(i=>
 '<div class="lc-row"><div><b>'+esc(i.number||i.tracking)+'</b> · '+esc(supplierName(i.supplierId))+' · '+esc(usd(cents(i.total)))+
 '</div><div><span class="lc-pills">'+esc(labels[i.status]||i.status)+'</span> <button type="button" class="lc-btn primary" data-lc-approve="'+esc(i.id)+'">Проверено, подтвердить</button></div>'+
 '<p style="flex-basis:100%">Состав: '+esc((i.items||[]).map(x=>x.name+' × '+x.qty).join(' / ').slice(0,350))+'</p></div>'
 ).join(''):'<p class="lc-muted lc-good">✓ Накладных, ожидающих проверки, нет.</p>';
}
function renderAudit(){
 $('lcAudit').innerHTML=(ops.auditTrail||[]).slice(-65).reverse().map(x=>
 '<div class="lc-row"><div><b>'+esc(x.summary)+'</b><p>'+esc(String(x.at||'').replace('T',' ').slice(0,19))+' · '+esc(x.source||'LANDA')+'</p></div></div>'
 ).join('')||'<p class="lc-muted">Журнал заполняется для новых действий после подключения обновления.</p>';
}
function download(data,name,mime){
 const blob=new Blob([data],{type:mime||'text/plain;charset=utf-8'}),u=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1200);
}
const safeCSV=x=>{
 let v=String(x??'');if(/^[\s]*[=+\-@]/.test(v))v="'"+v;
 return '"'+v.replace(/"/g,'""')+'"';
};
function statement(){
 const id=$('lcStatementSupplier').value,from=$('lcFrom').value,to=$('lcTo').value;
 if(!id||!from||!to||from>to)throw Error('Укажи правильный период и поставщика');
 const inv=ops.invoices.filter(i=>i.supplierId===id&&charged(i));
 const pays=ops.payments.filter(i=>i.supplierId===id);
 const toDate=x=>String(x.date||'');
 const oldInv=inv.filter(i=>toDate(i)<from).reduce((s,i)=>s+cents(i.total),0);
 const oldPays=pays.filter(p=>toDate(p)<from).reduce((s,p)=>s+cents(p.amount),0);
 const invoices=inv.filter(i=>toDate(i)>=from&&toDate(i)<=to);
 const payments=pays.filter(p=>toDate(p)>=from&&toDate(p)<=to);
 const billed=invoices.reduce((s,i)=>s+cents(i.total),0);
 const paid=payments.reduce((s,p)=>s+cents(p.amount),0);
 const opening=oldPays-oldInv,ending=opening+paid-billed;
 const rows=[...invoices.map(i=>({date:i.date,type:'Начисленная накладная',number:i.number||'',delta:-cents(i.total)})),...payments.map(p=>({date:p.date,type:p.isOpening?'Начальный аванс':'Перевод поставщику',number:p.note||'',delta:cents(p.amount)}))].sort((a,b)=>a.date.localeCompare(b.date));
 return {id,from,to,opening,ending,billed,paid,rows};
}
function renderStatement(){
 const x=statement();cs.statement=x;
 $('lcStatementPreview').innerHTML='<div class="lc-metrics">'+[
 ['Баланс на начало',usd(x.opening)],['Начислено за период',usd(x.billed)],
 ['Оплачено за период',usd(x.paid)],['Баланс на конец',usd(x.ending)]
 ].map(y=>'<div class="lc-metric"><small>'+y[0]+'</small><b>'+esc(y[1])+'</b></div>').join('')+'</div>'+
 '<div class="lc-list">'+x.rows.map(r=>'<div class="lc-row"><span>'+esc(r.date)+' · '+esc(r.type)+' · '+esc(r.number)+'</span><b>'+esc(usd(r.delta))+'</b></div>').join('')+'</div>';
}
function exportStatement(){
 if(!cs.statement)renderStatement();
 const x=cs.statement;
 const rows=[['Акт сверки LANDA',supplierName(x.id)],['Период',x.from+' — '+x.to],['Начальный баланс, $',amount(x.opening)],['Дата','Операция','Документ','Изменение баланса, $'],...x.rows.map(y=>[y.date,y.type,y.number,amount(y.delta)]),['Начислено за период, $',amount(x.billed)],['Переведено за период, $',amount(x.paid)],['Конечный баланс, $',amount(x.ending)]];
 download('\ufeff'+rows.map(row=>row.map(safeCSV).join(';')).join('\r\n'),'LANDA-сверка-'+x.id+'-'+x.to+'.csv','text/csv;charset=utf-8');
}
function profit(s){
 const gross=cents(s.qty*s.saleRub);
 const purchase=cents(s.qty*s.costUsd*s.rate);
 const fees=cents(s.feesRub)+cents(s.deliveryRub);
 return {gross,purchase,fees,net:gross-purchase-fees};
}
function renderSales(){
 const sales=(ops.sales||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,100);
 const all=ops.sales||[];
 const totals=all.reduce((a,s)=>{const p=profit(s);return {gross:a.gross+p.gross,net:a.net+p.net}}, {gross:0,net:0});
 $('lcSalesSummary').innerHTML=[['Выручка (справочно)',rub(totals.gross)],['Расчётная прибыль',rub(totals.net)],['Маржа',totals.gross?((totals.net/totals.gross)*100).toFixed(1)+' %':'—']].map(p=>'<div class="lc-metric"><small>'+esc(p[0])+'</small><b>'+esc(p[1])+'</b></div>').join('');
 $('lcSalesRows').innerHTML=sales.map(x=>{const p=profit(x);
 return '<div class="lc-row"><div><b>'+esc(x.item)+' · '+esc(x.channel)+'</b><p>'+esc(x.date)+' · '+esc(x.qty)+' шт. · выручка '+esc(rub(p.gross))+'</p></div><div><b>'+esc(rub(p.net))+'</b> <button type="button" class="lc-btn" data-lc-delete-sale="'+esc(x.id)+'">Удалить</button></div></div>'
 }).join('')||'<p class="lc-muted">Продажи пока не внесены. Данные не меняют денежную кассу.</p>';
}
function updateSaleSources(){
 const f=$('lcSaleForm'),sel=$('lcSaleSource'),old=sel.value;
 const sources=[['','Ввести вручную']];
 for(const i of ops.invoices.filter(i=>!i.isOpening))for(let n=0;n<(i.items||[]).length;n++){
  const row=i.items[n];sources.push([encodeURIComponent(i.id)+':'+n,(i.number||i.tracking)+' · '+row.name]);
 }
 sel.innerHTML=sources.map(([id,title])=>'<option value="'+esc(id)+'">'+esc(title)+'</option>').join('');
 if(sources.some(x=>x[0]===old))sel.value=old;
}
function saveSale(e){
 e.preventDefault();
 const f=e.currentTarget,x=Object.fromEntries(new FormData(f).entries());
 const qty=Number(x.qty),costUsd=Number(x.costUsd),rate=Number(x.rate),saleRub=Number(x.saleRub),feesRub=Number(x.feesRub),deliveryRub=Number(x.deliveryRub);
 if(!x.date||!x.item.trim()||![qty,costUsd,rate,saleRub,feesRub,deliveryRub].every(Number.isFinite)||qty<=0||rate<=0||[costUsd,saleRub,feesRub,deliveryRub].some(n=>n<0))return alert('Проверь дату, товар, курс и суммы продажи.');
 if(qty>100000||[costUsd,rate,saleRub,feesRub,deliveryRub].some(n=>n>1e8))return alert('Слишком большая сумма продажи.');
 const record={id:'sale-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),date:x.date,item:x.item.trim().slice(0,180),channel:x.channel,source:x.source||'',qty,costUsd,rate,saleRub,feesRub,deliveryRub};
 if(!Array.isArray(ops.sales))ops.sales=[];
 ops.sales.push(record);
 if(!saveOps()){ops.sales.pop();return alert('Не удалось сохранить продажу. Проверь доступность браузерного хранилища.')}
 f.reset();f.elements.date.value=today();renderSales();
}
function render(){
 $('lcStatementSupplier').innerHTML=ops.suppliers.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');
 renderMetrics();renderAudit();updateSaleSources();renderSales();
}
$('lcRefresh').addEventListener('click',render);
center.addEventListener('click',e=>{
 const approve=e.target.closest('[data-lc-approve]');
 if(approve){
  const i=ops.invoices.find(v=>v.id===approve.dataset.lcApprove);
  if(!i||!i.submittedAt||approval(i))return;
  if(!confirm('Ты проверил состав и стоимость накладной '+i.number+'? Подтвердить её для дальнейшего учёта?'))return;
  i.reviewStatus='approved';i.reviewedAt=iso();i.reviewedBy='owner';
  if(!saveOps())return alert('Не удалось сохранить подтверждение. Проверь журнал и синхронизацию.');
  render();renderOps();return;
 }
 const del=e.target.closest('[data-lc-delete-sale]');
 if(del){if(!confirm('Удалить запись продажи из аналитики? В кассе ничего не изменится.'))return;
  ops.sales=(ops.sales||[]).filter(s=>s.id!==del.dataset.lcDeleteSale);if(!saveOps())return alert('Запись не сохранена.');
  render();return;
 }
});
$('lcSaleSource').addEventListener('change',()=>{
 const f=$('lcSaleForm'),v=$('lcSaleSource').value;if(!v)return;
 const cut=v.lastIndexOf(':'),id=decodeURIComponent(v.slice(0,cut)),n=Number(v.slice(cut+1));
 const invoice=ops.invoices.find(i=>i.id===id),item=invoice?.items?.[n];
 if(item){f.elements.item.value=item.name;f.elements.costUsd.value=item.price;}
});
$('lcSaleForm').addEventListener('submit',saveSale);
$('lcStatementBuild').addEventListener('click',()=>{try{renderStatement()}catch(e){alert(e.message)}});
$('lcStatementCSV').addEventListener('click',()=>{try{renderStatement();exportStatement()}catch(e){alert(e.message)}});
$('lcStatementPrint').addEventListener('click',()=>{
 try{renderStatement();const content=$('lcStatementPreview').innerHTML;
  const paper=document.createElement('section');paper.className='lc-print-only';
  paper.innerHTML='<h1>LANDA · Акт сверки</h1><h2>'+esc(supplierName(cs.statement.id))+' · '+esc(cs.statement.from)+' — '+esc(cs.statement.to)+'</h2>'+content;
  document.body.appendChild(paper);
  window.addEventListener('afterprint',()=>paper.remove(),{once:true});
  window.print();setTimeout(()=>paper.remove(),3000);
 }catch(e){alert(e.message)}
});
$('lcSaleForm').elements.date.value=today();
const month=today().slice(0,7);
$('lcFrom').value=month+'-01';$('lcTo').value=today();
window.addEventListener('landa:data-changed',()=>setTimeout(render,0));
render();
window.LANDA_CONTROL={getIssues,profit,statement,render};
})();