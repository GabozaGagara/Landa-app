// LANDA shipment reconciliation. Separate local-only physical count; financial operations remain read-only.
import {collectShipmentRows,compareCount,aggregateProducts,receiptCSV} from './landa-receiving-core.mjs';

if(typeof document!=='undefined' && typeof ops!=='undefined') {
 const id='landa_receiving_counts_v1', $=x=>document.getElementById(x);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const qty=x=>Number(x).toLocaleString('ru-RU',{maximumFractionDigits:4});
 const statusLabels={created:'Создано',transit:'В пути',ready:'Готов к выдаче',delivered:'Вручено',received:'Вручено'};
 const comparisonLabels={pending:'Не сверено',matched:'Совпадает',difference:'Расхождение',invalid:'Ошибка ввода'};
 let records={},loadError='',tab='invoices';
 try{
  const raw=localStorage.getItem(id);
  if(raw){const d=JSON.parse(raw);if(d&&d.version===1&&d.entries&&typeof d.entries==='object'&&!Array.isArray(d.entries))records=d.entries;else loadError='Неверный формат локального журнала сверки.'}
 }catch(e){loadError='Не удалось прочитать сверку: '+e.message}
 const styles=document.createElement('style');
 styles.textContent=[
  '.rc-modal{border:0;border-radius:17px;width:min(1160px,calc(100vw - 20px));max-height:92dvh;padding:0;color:#20324b;background:#fff;box-shadow:0 25px 95px #0f1f3c44}',
  '.rc-modal::backdrop{background:#13233e95}.rc-modal *{box-sizing:border-box}',
  '.rc-modal header{background:#152b48;color:#fff;padding:17px 22px;display:flex;justify-content:space-between;align-items:center;gap:12px}',
  '.rc-modal header h2{margin:0;font-size:20px;color:#fff}.rc-body{padding:18px 22px 24px}',
  '.rc-hint{color:#65758a;font-size:12px;line-height:1.6}.rc-controls{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;align-items:end}',
  '.rc-controls label{font-size:12px;font-weight:600;color:#4c6078;display:flex;flex-direction:column;gap:4px;min-width:135px;flex:1}',
  '.rc-modal input,.rc-modal select{border:1px solid #cbd8e7;border-radius:9px;padding:9px;font:inherit;color:#162c49;background:#fff;min-width:0;width:100%}',
  '.rc-controls label.rc-check{display:flex;flex-direction:row;align-items:center;gap:7px;min-width:185px;flex:0 0 auto;padding-bottom:8px}',
  '.rc-modal input[type=checkbox]{width:auto;margin:0}',
  '.rc-btn{border:1px solid #c9d7e7;border-radius:9px;padding:9px 13px;font:inherit;font-size:13px;font-weight:600;color:#254b7a;background:#fff;cursor:pointer}',
  '.rc-btn-primary{background:#315ed2;border-color:#315ed2;color:#fff}.rc-btn-active{background:#e8f0ff;border-color:#4876c9}',
  '.rc-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 15px}',
  '.rc-stats{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.rc-stats span{background:#f0f5fc;padding:9px 13px;border-radius:9px;font-size:13px}',
  '.rc-shipment{border:1px solid #dce5f0;border-radius:12px;margin:13px 0;padding:12px 15px}',
  '.rc-shipment h3{font-size:15px;margin:0 0 5px;color:#1e3b60}.rc-item{display:grid;grid-template-columns:minmax(180px,1fr) 100px 135px 100px minmax(135px,1fr) 43px;gap:9px;align-items:center;border-top:1px solid #edf0f5;padding:11px 0}',
  '.rc-item-title{font-size:13px;font-weight:600;overflow-wrap:anywhere}.rc-sub{font-size:11px;color:#71829a;margin-top:3px}.rc-label{font-size:11px;color:#60748a;margin-bottom:3px}',
  '.rc-value{font-weight:700;font-size:13px}.rc-state{font-size:12px;font-weight:600}.rc-state.good{color:#087958}.rc-state.bad{color:#b13c45}.rc-state.wait{color:#7b8796}',
  '.rc-note{max-width:260px}.rc-report{background:#f6f9fd;border-radius:11px;padding:13px;margin:10px 0}',
  '.rc-aggregate{display:grid;grid-template-columns: minmax(170px,1fr) 90px 90px 90px;gap:10px;align-items:center;border-bottom:1px solid #e4eaf3;padding:12px 0;font-size:13px}',
  '.rc-warning{background:#fff7e8;padding:11px 13px;border-radius:8px;color:#765521;font-size:12px;margin:11px 0}',
  '@media(max-width:700px){.rc-modal header{padding:14px}.rc-body{padding:14px}.rc-item{grid-template-columns:1fr 1fr;gap:7px}.rc-item-title{grid-column:1/-1}.rc-note{max-width:100%}.rc-aggregate{grid-template-columns:1fr 75px 75px}.rc-aggregate .rc-last{grid-column:1/-1}.rc-controls label{flex:1 1 100%}}'
 ].join('');
 document.head.append(styles);
 const dialog=document.createElement('dialog');dialog.className='rc-modal';dialog.id='landaReceivingDialog';
 dialog.setAttribute('aria-label','Сверка товаров поставщиков');
 dialog.innerHTML=[
  '<header><h2>📦 Сверка товаров поставщиков</h2><button class="rc-btn" type="button" id="rcClose">Закрыть ×</button></header>',
  '<div class="rc-body"><p class="rc-hint">Позиции берутся из накладных, загруженных в LANDA на этом устройстве. Вводите количество, которое физически приняли и внесли в «МойСклад». Это ручная сверка, а не подключение к API «МоегоСклада».</p>',
  '<p class="rc-warning">Сверка хранится отдельно в этом браузере и не синхронизируется с GitHub. Скачивайте CSV для архива. Касса, долг, накладные и данные «МоегоСклада» не изменяются.</p>',
  '<div class="rc-controls"><label>Поставщик<select id="rcSupplier"><option value="all">Все поставщики</option></select></label>',
  '<label>Товар / артикул / СДЭК<input type="search" id="rcSearch" placeholder="Найти товар или накладную"></label>',
  '<label>Результат сверки<select id="rcStatus"><option value="all">Все</option><option value="pending">Не сверено</option><option value="difference">Расхождения</option><option value="matched">Совпадает</option></select></label>',
  '<label class="rc-check"><input type="checkbox" id="rcOnlyPortal"> Только из кабинетов поставщиков</label></div>',
  '<div class="rc-actions"><button class="rc-btn rc-btn-active" type="button" id="rcInvoices">По накладным</button><button class="rc-btn" type="button" id="rcProducts">Сводка товаров</button>',
  '<button class="rc-btn" type="button" id="rcExport">↓ Скачать CSV</button><button class="rc-btn" type="button" id="rcRefresh">↻ Обновить</button></div>',
  '<div id="rcSummary" class="rc-stats"></div><p id="rcMessage" class="rc-hint" role="status" aria-live="polite"></p><div id="rcResults"></div>',
  '</div>'
 ].join('');
 document.body.append(dialog);
 const btn=document.createElement('button');
 btn.type='button';btn.className='nav-btn core';btn.id='rcNavOpen';
 btn.innerHTML='<span class="nav-icon">📦</span><span class="nav-text">Сверка товаров</span>';
 const nav=document.querySelector('.op-nav'),calc=nav?.querySelector('[data-page="proschet"]');
 if(calc)calc.before(btn);else nav?.append(btn);
 const invoicesPage=$('invoicesPage');
 if(invoicesPage){
  const head=invoicesPage.querySelector('.heading .actions');
  if(head){const b=document.createElement('button');b.type='button';b.className='btn';b.id='rcInvoicesOpen';b.textContent='📦 Сверка товаров';head.append(b)}
 }
 function supplierNames(){
  return Object.fromEntries((ops.suppliers||[]).map(x=>[String(x.id),String(x.name||x.id)]));
 }
 function refreshSuppliers(){
  const sel=$('rcSupplier'),old=sel.value,options=[['all','Все поставщики'],...(ops.suppliers||[]).map(s=>[String(s.id),String(s.name||s.id)])];
  sel.innerHTML=options.map(x=>'<option value="'+esc(x[0])+'">'+esc(x[1])+'</option>').join('');
  sel.value=options.some(x=>x[0]===old)?old:'all';
 }
 function store(){
  try{localStorage.setItem(id,JSON.stringify({version:1,entries:records}));$('rcMessage').textContent='✓ Сверка сохранена только на этом устройстве. Для переноса скачайте CSV.';return true}
  catch(e){$('rcMessage').textContent='Не удалось сохранить сверку: '+e.message+'. Не закрывайте страницу, экспортируйте CSV.';return false}
 }
 function getRows(){
  return collectShipmentRows(ops.invoices,{supplier:$('rcSupplier').value,onlyPortal:$('rcOnlyPortal').checked,search:$('rcSearch').value});
 }
 function selectedRows(){
  const status=$('rcStatus').value;
  return getRows().filter(row=>status==='all'||compareCount(row,records[row.key]).state===status);
 }
 function markupRow(row){
  const v=records[row.key]||{},comp=compareCount(row,v),state=comp.state;
  const label=comparisonLabels[state]||state,cl=state==='matched'?'good':state==='difference'?'bad':'wait';
  const difference=comp.delta===null?'—':(comp.delta>0?'+':'')+qty(comp.delta);
  return '<div class="rc-item">'+
   '<div><div class="rc-item-title">'+esc(row.name||'Без названия')+'</div><div class="rc-sub">'+(row.sku?'Артикул: '+esc(row.sku):'Без артикула')+'</div></div>'+
   '<div><div class="rc-label">По накладной</div><div class="rc-value">'+esc(qty(row.qty))+' шт.</div></div>'+
   '<div><div class="rc-label">Принято, шт.</div><input type="number" min="0" step="any" inputmode="decimal" aria-label="Фактически принято, '+esc(row.name)+'" data-rc-count="'+esc(row.key)+'" value="'+esc(v.received??'')+'" placeholder="Не сверено"></div>'+
   '<div><div class="rc-label">Разница</div><div class="rc-value">'+esc(difference)+'</div><div class="rc-state '+cl+'">'+esc(label)+'</div></div>'+
   '<div><div class="rc-label">Комментарий</div><input class="rc-note" type="text" maxlength="240" data-rc-note="'+esc(row.key)+'" value="'+esc(v.note||'')+'" placeholder="Недостача, пересорт…"></div>'+
   '<button type="button" class="rc-btn" title="Очистить результат сверки" aria-label="Очистить сверку" data-rc-clear="'+esc(row.key)+'">↺</button></div>';
 }
 function render(){
  if(!dialog.open)return;
  const rows=selectedRows(),all=getRows(),names=supplierNames();
  const done=all.filter(r=>['matched','difference'].includes(compareCount(r,records[r.key]).state));
  const discrepancies=done.filter(r=>compareCount(r,records[r.key]).state==='difference');
  const shipments=new Set(all.map(r=>r.invoiceId));
  $('rcSummary').innerHTML=[
   '<span>Накладных: <b>'+shipments.size+'</b></span>',
   '<span>Товарных строк: <b>'+all.length+'</b></span>',
   '<span>Проверено: <b>'+done.length+'</b></span>',
   '<span>Расхождений: <b>'+discrepancies.length+'</b></span>'
  ].join('');
  $('rcInvoices').classList.toggle('rc-btn-active',tab==='invoices');
  $('rcProducts').classList.toggle('rc-btn-active',tab==='products');
  if(!rows.length){$('rcResults').innerHTML='<p class="rc-report rc-hint">По выбранным фильтрам товаров нет. Проверьте фильтры и убедитесь, что актуальные накладные загружены из GitHub в LANDA.</p>';return}
  if(tab==='products'){
   const products=aggregateProducts(rows,records);
   $('rcResults').innerHTML='<p class="rc-hint">Сводка объединяет одинаковые артикулы и названия внутри одного поставщика. Если часть накладных не сверена, итоговое «Принято» пока не рассчитывается.</p>'+
    products.map(p=>'<div class="rc-aggregate"><div><b>'+esc(p.name||'Без названия')+'</b><div class="rc-sub">'+esc(names[p.supplierId]||p.supplierId)+(p.sku?' · '+esc(p.sku):'')+' · накладных: '+p.invoices.length+'</div></div>'+
    '<div><div class="rc-label">Заявлено</div><b>'+esc(qty(p.expected))+'</b></div>'+
    '<div><div class="rc-label">Принято</div><b>'+(p.received===null?'—':esc(qty(p.received)))+'</b></div>'+
    '<div class="rc-last"><div class="rc-label">Разница / сверено</div><b>'+(p.delta===null?'—':esc((p.delta>0?'+':'')+qty(p.delta)))+'</b> · '+p.done+'/'+p.lines+'</div></div>').join('');
   return;
  }
  const groups=new Map();
  for(const r of rows){const key=JSON.stringify([r.supplierId,r.invoiceId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
  $('rcResults').innerHTML=Array.from(groups.values()).map(group=>{
   const f=group[0],review=f.submittedAt?(f.reviewStatus==='approved'?'Проверена владельцем':'Ждёт проверки владельцем'):'Введена в LANDA вручную';
   return '<section class="rc-shipment"><h3>'+esc(names[f.supplierId]||f.supplierId)+' · накладная '+esc(f.invoice)+'</h3>'+
    '<div class="rc-hint">'+esc(f.date)+' · СДЭК '+esc(f.tracking||'не указан')+' · '+esc(statusLabels[f.status]||f.status)+' · '+esc(review)+'</div>'+
    group.map(markupRow).join('')+'</section>';
  }).join('');
 }
 function open(){
  refreshSuppliers();dialog.showModal();if(typeof closeMobile==='function')closeMobile();
  $('rcMessage').textContent=loadError||'Для свежих данных сначала загрузите последнюю облачную копию в LANDA. Изменения сверки не отправляются в GitHub.';
  render();
 }
 btn.addEventListener('click',open);
 $('rcInvoicesOpen')?.addEventListener('click',open);
 $('rcClose').addEventListener('click',()=>dialog.close());
 for(const key of ['rcSupplier','rcStatus','rcOnlyPortal'])$(key).addEventListener('change',render);
 $('rcSearch').addEventListener('input',render);
 $('rcInvoices').addEventListener('click',()=>{tab='invoices';render()});
 $('rcProducts').addEventListener('click',()=>{tab='products';render()});
 $('rcRefresh').addEventListener('click',()=>{refreshSuppliers();render()});
 $('rcResults').addEventListener('change',e=>{
  const el=e.target;
  const count=el.getAttribute('data-rc-count'),note=el.getAttribute('data-rc-note');
  if(count===null&&note===null)return;
  const key=count??note,old=records[key]||{received:'',note:''},value=el.value;
  if(count!==null && value!=='' && (!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100000000)){
   alert('Укажите неотрицательное количество, не более 100 000 000.');render();return;
  }
  records[key]={...old,[count!==null?'received':'note']:count!==null?(value===''?'':Number(value)):value.slice(0,240),at:new Date().toISOString()};
  store();render();
 });
 $('rcResults').addEventListener('click',e=>{
  const el=e.target.closest('[data-rc-clear]');if(!el)return;
  if(!confirm('Удалить результат ручной сверки для этой товарной строки?'))return;
  delete records[el.dataset.rcClear];store();render();
 });
 $('rcExport').addEventListener('click',()=>{
  const rows=selectedRows();if(!rows.length){alert('Нет товарных строк для экспорта.');return}
  const data=receiptCSV(rows,records,supplierNames()),blob=new Blob([data],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='LANDA-сверка-товаров-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
 });
 window.addEventListener('landa:data-changed',()=>{if(dialog.open)render()});
 window.LANDA_RECEIVING={open,render};
}
