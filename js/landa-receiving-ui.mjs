// LANDA shipment reconciliation. Separate local-only physical count; financial operations remain read-only.
import {collectShipmentRows,compareCount,aggregateProducts,receiptCSV,productIdentity,safeProductAliases,mergeProductAliases,unmergeProductAliases,renameProductAlias,filterProductSummary,csvCell} from './landa-receiving-core.mjs';

if(typeof document!=='undefined' && typeof ops!=='undefined') {
 const id='landa_receiving_counts_v1', aliasStorageKey='landa_receiving_product_aliases_v1', $=x=>document.getElementById(x);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const qty=x=>Number(x).toLocaleString('ru-RU',{maximumFractionDigits:4});
 const statusLabels={created:'Создано',transit:'В пути',ready:'Готов к выдаче',delivered:'Вручено',received:'Вручено'};
 const comparisonLabels={pending:'Не сверено',matched:'Совпадает',difference:'Расхождение',invalid:'Ошибка ввода'};
 let records={},loadError='',tab='invoices';
 let aliases={version:1,groups:[]},mergeMode=false,selectedProducts=new Set(),visibleProducts=[];
 try{
  const raw=localStorage.getItem(aliasStorageKey);
  if(raw){const data=JSON.parse(raw);if(!data||data.version!==1||!Array.isArray(data.groups))throw Error('Неверный формат объединений');aliases=safeProductAliases(data);}
 }catch(e){loadError='Не удалось загрузить объединения товаров: '+e.message+'. Старые накладные и сверка не затронуты.'}
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
  '.rc-merge-panel{border:1px solid #bed0e9;background:#f5f8ff;border-radius:12px;padding:13px;margin:12px 0;display:grid;gap:10px}',
  '.rc-merge-panel[hidden]{display:none}.rc-merge-panel label{font-weight:600;font-size:12px;display:grid;gap:5px}',
  '.rc-merge-panel .rc-btn:disabled{opacity:.5;cursor:not-allowed}.rc-merge-actions{display:flex;flex-wrap:wrap;gap:7px}',
  '.rc-aggregate .rc-merge-check{display:inline-flex;align-items:center;gap:6px;margin-right:8px;cursor:pointer}',
  '.rc-alias-tag{display:inline-block;font-size:11px;font-weight:700;color:#145d7c;background:#e1f5fa;border-radius:6px;padding:2px 6px;margin-top:5px}',
  '.rc-alias-variants{font-size:12px;color:#516780;margin-top:5px}.rc-alias-variants summary{cursor:pointer}',
  '.rc-alias-variants ul{padding-left:17px;margin:6px 0;line-height:1.6}.rc-aggregate .rc-alias-manage{margin:5px 6px 0 0;font-size:11px;padding:4px 7px}',
  '.rc-merge-panel .rc-hint{margin:0}',

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
  '<button class="rc-btn" type="button" id="rcExport">↓ Скачать CSV</button><button class="rc-btn" type="button" id="rcExportMerged" hidden>↓ CSV объединённой сводки</button>',
  '<button class="rc-btn" type="button" id="rcMergeToggle" hidden>⇄ Объединить позиции</button><button class="rc-btn" type="button" id="rcRefresh">↻ Обновить</button></div>',
  '<div id="rcMergePanel" class="rc-merge-panel" hidden><strong>Ручное объединение названий</strong>',
  '<p class="rc-hint">Отметьте 2 или больше позиций ниже, даже от разных поставщиков. Задайте общее название: исходные строки, артикула и поставщики сохраняются, суммы и сверка пересчитываются только в сводке.</p>',
  '<div id="rcMergeSelected" class="rc-hint">Выбрано: 0</div><label>Общее название товара<input id="rcMergeName" maxlength="180" placeholder="Например: Karcher Puzzi 10/1"></label>',
  '<div class="rc-merge-actions"><button class="rc-btn rc-btn-primary" type="button" id="rcMergeSave" disabled>Объединить выбранные</button><button class="rc-btn" type="button" id="rcMergeClear">Снять выделение</button>',
  '<button class="rc-btn" type="button" id="rcAliasDownload">↓ Сохранить объединения JSON</button><button class="rc-btn" type="button" id="rcAliasUpload">↑ Загрузить объединения JSON</button></div>',
  '<p class="rc-hint">Правила объединения хранятся в этом браузере, не в финансовой базе. Для переноса на другой компьютер или телефон используйте JSON-файл.</p>',
  '<input type="file" id="rcAliasFile" accept=".json,application/json" hidden></div>',
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
 function storeAliases(next){
  const cleaned=safeProductAliases(next);
  if(cleaned.groups.length!==next.groups.length)throw Error('Некорректное правило объединения.');
  const raw=JSON.stringify(cleaned);
  try{
   localStorage.setItem(aliasStorageKey,raw);
   if(localStorage.getItem(aliasStorageKey)!==raw)throw Error('Браузер не подтвердил запись');
  }catch(e){throw Error('Не удалось сохранить объединения: '+e.message)}
  aliases=cleaned;
  $('rcMessage').textContent='✓ Правила объединения сохранены только в этом браузере. Финансовые данные и накладные не изменены.';
 }
 function refreshMergeSelection(){
  const valid=new Set(visibleProducts.map(p=>p.key));
  for(const k of selectedProducts)if(!valid.has(k))selectedProducts.delete(k);
  const chosen=visibleProducts.filter(p=>selectedProducts.has(p.key));
  $('rcMergeSelected').textContent='Выбрано: '+chosen.length+(chosen.length?' · '+chosen.map(p=>p.name).join(' + ').slice(0,300):'');
  $('rcMergeSave').disabled=chosen.length<2;
  if(chosen.length>=2&&!$('rcMergeName').value.trim())$('rcMergeName').value=chosen[0].name;
 }
 function downloadNamed(data,name,mime){
  const u=URL.createObjectURL(new Blob([data],{type:mime}));
  const a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1200);
 }
 function summaryCSV(products,names){
  const header=['Общий товар','Исходные названия и артикулы','Поставщики','Накладных','Заявлено, шт.','Принято, шт.','Разница, шт.','Сверено строк','Всего строк'];
  const lines=products.map(g=>[
   g.name,g.variants.map(v=>v.name+(v.sku?' ['+v.sku+']':'')+' ('+(names[v.supplierId]||v.supplierId)+')').join(' / '),
   g.suppliers.map(id=>names[id]||id).join(', '),g.invoices.length,
   g.expected,g.received??'',g.delta??'',g.done,g.lines
  ]);
  return '\ufeff'+[header,...lines].map(line=>line.map(csvCell).join(';')).join('\r\n');
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
   '<div><div class="rc-item-title">'+esc(row.name||'Без названия')+'</div><div class="rc-sub">'+(row.sku?'Артикул: '+esc(row.sku):'Без артикула')+' · '+(row.price>0?'Цена: '+esc(row.price)+' $/шт.':'Цена не указана')+'</div></div>'+
   '<div><div class="rc-label">По накладной</div><div class="rc-value">'+esc(qty(row.qty))+' шт.</div></div>'+
   '<div><div class="rc-label">Принято, шт.</div><input type="number" min="0" step="any" inputmode="decimal" aria-label="Фактически принято, '+esc(row.name)+'" data-rc-count="'+esc(row.key)+'" value="'+esc(v.received??'')+'" placeholder="Не сверено"></div>'+
   '<div><div class="rc-label">Разница</div><div class="rc-value">'+esc(difference)+'</div><div class="rc-state '+cl+'">'+esc(label)+'</div></div>'+
   '<div><div class="rc-label">Комментарий</div><input class="rc-note" type="text" maxlength="240" data-rc-note="'+esc(row.key)+'" value="'+esc(v.note||'')+'" placeholder="Недостача, пересорт…"></div>'+
   '<button type="button" class="rc-btn" title="Очистить результат сверки" aria-label="Очистить сверку" data-rc-clear="'+esc(row.key)+'">↺</button></div>';
 }
 function render(){
  if(!dialog.open)return;
  let rows=selectedRows(),all=getRows();const names=supplierNames();
  let products=null;
  if(tab==='products'){
   // Search and status filters match whole canonical groups; calculate totals
   // from all their source lines, never from just the matching sub-lines.
   const source=collectShipmentRows(ops.invoices,{
    supplier:$('rcSupplier').value,onlyPortal:$('rcOnlyPortal').checked,search:''
   });
   products=filterProductSummary(aggregateProducts(source,records,aliases),source,records,{
    search:$('rcSearch').value,status:$('rcStatus').value
   });
   const keys=new Set(products.flatMap(p=>p.members));
   all=source.filter(r=>keys.has(productIdentity(r)));rows=all;
  }
  const done=all.filter(r=>['matched','difference'].includes(compareCount(r,records[r.key]).state));
  const discrepancies=done.filter(r=>compareCount(r,records[r.key]).state==='difference');
  const shipments=new Set(all.map(r=>r.invoiceId));
  const expectedQty=all.reduce((sum,r)=>sum+r.qty,0);
  $('rcSummary').innerHTML=[
   '<span>Накладных: <b>'+shipments.size+'</b></span>',
   '<span>Товарных строк: <b>'+all.length+'</b></span>',
   '<span>Заявлено единиц: <b>'+qty(expectedQty)+'</b></span>',
   '<span>Проверено: <b>'+done.length+'</b></span>',
   '<span>Расхождений: <b>'+discrepancies.length+'</b></span>'
  ].join('');
  $('rcInvoices').classList.toggle('rc-btn-active',tab==='invoices');
  $('rcProducts').classList.toggle('rc-btn-active',tab==='products');
  $('rcMergeToggle').hidden=tab!=='products';
  $('rcExportMerged').hidden=tab!=='products';
  $('rcMergeToggle').classList.toggle('rc-btn-active',mergeMode);
  $('rcMergeToggle').textContent=mergeMode?'✓ Завершить объединение':'⇄ Объединить позиции';
  $('rcMergePanel').hidden=tab!=='products'||!mergeMode;
  if(!rows.length){visibleProducts=[];selectedProducts.clear();if(mergeMode)refreshMergeSelection();$('rcResults').innerHTML='<p class="rc-report rc-hint">По выбранным фильтрам товаров нет. Проверьте фильтры и убедитесь, что актуальные накладные загружены из GitHub в LANDA.</p>';return}
  if(tab==='products'){
   visibleProducts=products;
   $('rcResults').innerHTML='<p class="rc-hint">Одинаковые позиции внутри поставщика группируются автоматически. Разные названия, в том числе разных поставщиков, объединяются вручную. Поиск и фильтр статуса показывают товар целиком; «Принято» не вычисляется, пока не сверены все входящие строки.</p>'+
    products.map(p=>{
     const combined=p.merged,source=p.variants.map(v=>
      '<li>'+esc(names[v.supplierId]||v.supplierId)+' · '+esc(v.name)+(v.sku?' ['+esc(v.sku)+']':'')+
      ' · '+v.lines+' строк</li>').join('');
     const selection=mergeMode?'<label class="rc-merge-check"><input type="checkbox" data-rc-select="'+esc(p.key)+'" '+(selectedProducts.has(p.key)?'checked':'')+' aria-label="Выбрать '+esc(p.name)+' для объединения"></label>':'';
     const supplierLabels=p.suppliers.map(id=>names[id]||id).join(', ');
     return '<div class="rc-aggregate"><div>'+selection+'<b>'+esc(p.name||'Без названия')+'</b>'+
      (combined?'<div class="rc-alias-tag">✓ Объединено вручную · '+p.variants.length+' названий</div>':'')+
      '<div class="rc-sub">'+esc(supplierLabels)+(p.skus.length===1?' · '+esc(p.skus[0]):'')+' · накладных: '+p.invoices.length+'</div>'+
      (combined?'<details class="rc-alias-variants"><summary>Исходные названия / поставщики ('+p.variants.length+')</summary><ul>'+source+'</ul></details>':'')+
      (combined?'<button type="button" class="rc-btn rc-alias-manage" data-rc-rename="'+esc(p.aliasId)+'">Переименовать</button>'+
       '<button type="button" class="rc-btn rc-alias-manage" data-rc-unmerge="'+esc(p.aliasId)+'">Разъединить</button>':'')+
      '</div><div><div class="rc-label">Заявлено</div><b>'+esc(qty(p.expected))+'</b></div>'+
      '<div><div class="rc-label">Принято</div><b>'+(p.received===null?'—':esc(qty(p.received)))+'</b></div>'+
      '<div class="rc-last"><div class="rc-label">Разница / сверено</div><b>'+(p.delta===null?'—':esc((p.delta>0?'+':'')+qty(p.delta)))+'</b> · '+p.done+'/'+p.lines+'</div></div>';
    }).join('');
   if(mergeMode)refreshMergeSelection();
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
 for(const key of ['rcSupplier','rcStatus','rcOnlyPortal'])$(key).addEventListener('change',()=>{selectedProducts.clear();render()});
 $('rcSearch').addEventListener('input',()=>{selectedProducts.clear();render()});
 $('rcInvoices').addEventListener('click',()=>{tab='invoices';selectedProducts.clear();render()});
 $('rcProducts').addEventListener('click',()=>{tab='products';render()});
 $('rcMergeToggle').addEventListener('click',()=>{mergeMode=!mergeMode;selectedProducts.clear();$('rcMergeName').value='';render()});
 $('rcMergeClear').addEventListener('click',()=>{selectedProducts.clear();$('rcMergeName').value='';render()});
 $('rcMergeSave').addEventListener('click',()=>{
  const chosen=visibleProducts.filter(p=>selectedProducts.has(p.key));
  if(chosen.length<2){alert('Выберите как минимум две позиции для объединения.');return}
  const name=$('rcMergeName').value.trim();
  if(!name){alert('Укажите общее название товара.');$('rcMergeName').focus();return}
  const description=chosen.map(p=>p.name+' ('+p.suppliers.map(supplierId=>supplierNames()[supplierId]||supplierId).join(', ')+')').join(' + ');
  if(!confirm('Объединить '+chosen.length+' позиции как «'+name+'»?\n'+description.slice(0,650)+'\nИсходные накладные и значения сверки не изменятся.'))return;
  try{
   const next=mergeProductAliases(aliases,chosen,name,'rc-'+crypto.randomUUID());
   storeAliases(next);selectedProducts.clear();$('rcMergeName').value='';render();
  }catch(e){alert(e.message)}
 });
 $('rcAliasDownload').addEventListener('click',()=>{
  downloadNamed(JSON.stringify(aliases,null,2),'LANDA-объединения-товаров-'+new Date().toISOString().slice(0,10)+'.json','application/json;charset=utf-8');
 });
 $('rcAliasUpload').addEventListener('click',()=>$('rcAliasFile').click());
 $('rcAliasFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{
   if(file.size>250000)throw Error('Файл объединений слишком большой.');
   const data=JSON.parse(await file.text());
   if(!data||data.version!==1||!Array.isArray(data.groups))throw Error('Неверный формат файла объединений.');
   const next=safeProductAliases(data);
   if(next.groups.length!==data.groups.length)throw Error('В файле есть повреждённые или повторяющиеся правила.');
   if(!confirm('Заменить локальные правила объединения ('+aliases.groups.length+') правилами из файла ('+next.groups.length+')? Финансовые данные не изменятся.'))return;
   storeAliases(next);selectedProducts.clear();render();
  }catch(err){alert('Не удалось загрузить объединения: '+err.message)}
 });
 $('rcExportMerged').addEventListener('click',()=>{
  const source=collectShipmentRows(ops.invoices,{supplier:$('rcSupplier').value,onlyPortal:$('rcOnlyPortal').checked,search:''});
  const products=filterProductSummary(aggregateProducts(source,records,aliases),source,records,{search:$('rcSearch').value,status:$('rcStatus').value});
  if(!products.length){alert('В сводке нет товаров для экспорта.');return}
  downloadNamed(summaryCSV(products,supplierNames()),'LANDA-сводка-объединённых-товаров-'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8');
 });
 $('rcRefresh').addEventListener('click',()=>{refreshSuppliers();render()});
 $('rcResults').addEventListener('change',e=>{
  const el=e.target;
  const select=el.getAttribute('data-rc-select');
  if(select!==null){
   if(!mergeMode)return;
   if(el.checked)selectedProducts.add(select);else selectedProducts.delete(select);
   refreshMergeSelection();return;
  }
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
  const unmerge=e.target.closest('[data-rc-unmerge]');
  if(unmerge){
   const rule=aliases.groups.find(g=>g.id===unmerge.dataset.rcUnmerge);
   if(!rule||!confirm('Разъединить «'+rule.name+'»? Исходные товары снова будут отображаться отдельно; сверка не изменится.'))return;
   try{storeAliases(unmergeProductAliases(aliases,rule.id));selectedProducts.clear();render()}catch(err){alert(err.message)}
   return;
  }
  const rename=e.target.closest('[data-rc-rename]');
  if(rename){
   const rule=aliases.groups.find(g=>g.id===rename.dataset.rcRename);if(!rule)return;
   const name=prompt('Новое общее название товара:',rule.name);if(name===null)return;
   try{storeAliases(renameProductAlias(aliases,rule.id,name));selectedProducts.clear();render()}catch(err){alert(err.message)}
   return;
  }
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
