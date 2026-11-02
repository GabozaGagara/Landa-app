// Mixed pallet intake workflow. Independent of accounting, invoices and existing reconciliation values.
import {
 PALLET_STORAGE_KEY,palletEmpty,palletValidate,palletCreate,palletSelect,palletExpected,
 palletAdd,palletEditEntry,palletRemoveEntry,palletClose,palletSummary,palletSuggestions,
 palletInvoiceKey,palletInvoiceSnapshot,palletShortNumber,palletCSV
} from './landa-pallet-core.mjs';

if(typeof document!=='undefined'&&typeof ops!=='undefined'&&document.getElementById('landaReceivingDialog')){
 const $=x=>document.getElementById(x);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:3});
 const names=()=>Object.fromEntries((ops.suppliers||[]).map(s=>[String(s.id),String(s.name||s.id)]));
 const day=()=>{const d=new Date(),f=v=>String(v).padStart(2,'0');return d.getFullYear()+'-'+f(d.getMonth()+1)+'-'+f(d.getDate())};
 const timestamp=t=>{try{return new Date(t).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}catch(_){return String(t)}};
 const labels={created:'Создан',transit:'В пути',ready:'Готов к выдаче',delivered:'Вручен',received:'Вручен'};
 const original=document.getElementById('rcResults');
 const parent=document.getElementById('rcSummary')?.parentElement;
 if(!original||!parent)throw Error('Не найден контейнер сверки товаров LANDA.');
 const css=document.createElement('style');
 css.textContent=[
  '#rcPalletPanel[hidden],#rcResults[hidden],#rcSummary[hidden],.rc-controls[hidden],#rcMergePanel[hidden],#rcMessage[hidden]{display:none!important}',
  '.pl-wrap{display:grid;gap:15px}.pl-head{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}',
  '.pl-box{border:1px solid #dce6f3;border-radius:12px;padding:15px;background:white;min-width:0}',
  '.pl-box h3{font-size:15px;margin:0 0 9px;color:#1d385b}.pl-muted{font-size:12px;color:#65778d;line-height:1.6}',
  '.pl-select-row{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:10px 0}.pl-select-row label{display:grid;gap:5px;font-size:12px;font-weight:600;color:#45617d;min-width:160px;flex:1}',
  '.pl-wrap input:not([type="checkbox"]),.pl-wrap select{border:1px solid #c5d3e5;border-radius:8px;padding:10px;font:inherit;font-size:14px;color:#1b3454;background:white;min-width:0;width:100%}',
  '.pl-wrap input[type=checkbox]{accent-color:#315ed2;width:17px;height:17px;flex:0 0 auto}',
  '.pl-banners{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.pl-banners>span{padding:8px 11px;border-radius:9px;background:#f0f5fd;font-size:12px;color:#27466a}',
  '.pl-invoice-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;max-height:280px;overflow-y:auto;margin-top:12px}',
  '.pl-invoice{display:flex;gap:10px;align-items:start;padding:10px;border-radius:9px;border:1px solid #d5e0ef;cursor:pointer}',
  '.pl-invoice.checked{background:#edf5ff;border-color:#80a2ec}.pl-invoice b{font-size:14px}.pl-invoice .pl-muted{margin-top:3px;display:block}',
  '.pl-badge{display:inline-block;font-size:11px;border-radius:6px;padding:2px 6px;background:#edf2f9;color:#476382}',
  '.pl-entry-fields{display:grid;grid-template-columns:minmax(140px,1fr) minmax(160px,2fr) 90px 110px;gap:9px;align-items:end}',
  '.pl-entry-fields label{font-size:12px;color:#496481;font-weight:600;display:grid;gap:4px}',
  '.pl-entry-fields .pl-action{align-self:end}.pl-entry-fields .rc-btn{width:100%}',
  '.pl-shortcuts{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}.pl-shortcuts button{font-size:11px;padding:6px 8px}',
  '.pl-table{width:100%;border-collapse:collapse;min-width:500px;font-size:12px}.pl-table td,.pl-table th{padding:9px 7px;text-align:left;border-bottom:1px solid #e5ebf3;vertical-align:top}',
  '.pl-table th{font-weight:700;color:#47617e;background:#f5f8fd}.pl-table strong{font-size:13px}',
  '.pl-scroll{overflow-x:auto;max-width:100%}.pl-warning{color:#926015}.pl-good{color:#167852}.pl-alert{color:#ad3a44}',
  '.pl-actions{display:flex;gap:7px;flex-wrap:wrap}.pl-actions button{font-size:11px;padding:6px 8px}',
  '.pl-final-list{display:grid;gap:9px}.pl-final{border:1px solid #dce6f3;border-radius:10px;padding:10px 12px}',
  '.pl-final summary{cursor:pointer;font-size:13px;font-weight:700;color:#203d63}.pl-final ul{font-size:12px;line-height:1.7;margin-bottom:0}',
  '@media(max-width:730px){.pl-entry-fields{grid-template-columns:1fr 1fr}.pl-entry-fields .pl-wide{grid-column:1/-1}.pl-entry-fields .pl-action{grid-column:1/-1}.pl-invoice-list{grid-template-columns:1fr}}',
  '@media(max-width:450px){.pl-entry-fields{grid-template-columns:1fr}.pl-entry-fields .pl-wide,.pl-entry-fields .pl-action{grid-column:auto}}'
 ].join('');document.head.append(css);
 const panel=document.createElement('div');panel.id='rcPalletPanel';panel.hidden=true;panel.className='pl-wrap';
 panel.innerHTML=[
  '<div class="pl-box"><div class="pl-head"><div><h3>🚚 Приёмка смешанного паллета в СДЭК</h3><div class="pl-muted">Сначала отметь накладные, затем добавляй товар с каждой в любом порядке. Одна запись — найденное место или группа одинаковых мест. История сохраняет последовательность погрузки.</div></div><button type="button" class="rc-btn rc-btn-primary" id="plNew">＋ Новая приёмка</button></div>',
  '<div class="pl-select-row"><label>Текущая приёмка<select id="plSessions"></select></label><button type="button" class="rc-btn" id="plCloseSession">Завершить</button>',
  '<button type="button" class="rc-btn" id="plExportCSV">↓ Итог + журнал CSV</button><button type="button" class="rc-btn" id="plExportJSON">↓ Архив JSON</button><button type="button" class="rc-btn" id="plImportJSON">↑ Импорт JSON</button><input id="plImportFile" type="file" accept=".json,application/json" hidden></div>',
  '<div id="plOverview" class="pl-banners"></div><div id="plInfo" class="pl-muted" role="status" aria-live="polite"></div></div>',
  '<div class="pl-box" id="plChooseBlock"><h3>1. Выбери накладные</h3>',
  '<div class="pl-muted">Номер показывается по последним 4 цифрам. Чтобы не перепутать похожие номера, рядом указан поставщик; при совпадении последних цифр показывается дополнительная часть номера. Используется полный ID накладной.</div>',
  '<div class="pl-select-row"><label>Поиск по последним цифрам, поставщику или номеру<input id="plSearch" type="search" placeholder="Например, 1111"></label>',
  '<label>Статус доставки<select id="plStatus"><option value="ready">Готов к выдаче</option><option value="all">Все статусы</option><option value="transit">В пути</option><option value="delivered">Вручен</option><option value="created">Создан</option></select></label></div>',
  '<div id="plInvoices" class="pl-invoice-list"></div><div id="plInvoicesMessage" class="pl-muted"></div><button type="button" class="rc-btn" id="plMore" hidden>Показать ещё</button></div>',
  '<div class="pl-box" id="plEnterBlock"><h3>2. Записывай фактические места по мере погрузки</h3>',
  '<form id="plEntryForm"><div class="pl-entry-fields">',
  '<label class="pl-wide">Накладная<select id="plCurrentInvoice" required></select></label>',
  '<label class="pl-wide">Что фактически забрал<input id="plProduct" type="text" list="plProductHints" maxlength="180" required placeholder="Например, Karcher Puzzi 10/1" autocomplete="off"></label><datalist id="plProductHints"></datalist>',
  '<label>Мест<input id="plPlaces" inputmode="numeric" type="number" min="1" step="1" value="1" required></label>',
  '<label>Товара, шт. (необяз.)<input id="plUnits" type="number" inputmode="decimal" min="0.001" step="any" placeholder="Неизвестно"></label>',
  '<div class="pl-action"><button class="rc-btn rc-btn-primary" id="plSaveEntry" type="submit">＋ Добавить в машину</button></div>',
  '</div></form><div id="plSuggestions" class="pl-shortcuts"></div>',
  '<p class="pl-muted">Места = физические коробки/упаковки. «Штук товара» вводи только если знаешь количество внутри; программа не приравнивает его к числу мест. Для следующего места из другой накладной просто переключи номер.</p></div>',
  '<div class="pl-box"><h3>3. Журнал погрузки — в порядке добавления</h3><div class="pl-scroll" id="plLog"></div></div>',
  '<div class="pl-box"><h3>4. Итог по каждой накладной</h3>',
  '<p class="pl-muted">Вводи «Ожидается мест», если это число известно; иначе программа честно покажет только фактически забранные места. Сравнение заявленных штук товара и фактических штук выполняется лишь при заполнении количества штук для каждой записи.</p>',
  '<div id="plReport"></div></div>',
  '<div class="pl-box"><h3>Важно о сохранении</h3><p class="pl-muted">Приёмка сохраняется отдельно в браузере этого устройства. Она не помечает накладную вручённой и не изменяет старую сверку товаров, кассу, долги или платежи. Сохраняй JSON-архив для переноса на другое устройство и восстановления.</p></div>'
 ].join('');
 parent.append(panel);
 let book=palletEmpty(),currentId='',activeInvoice='',searchLimit=36,infoError='',editingEntry='',savedRaw=null;
 try{
  const raw=localStorage.getItem(PALLET_STORAGE_KEY);
  savedRaw=raw;
  if(raw)book=palletValidate(JSON.parse(raw));
 }catch(e){infoError='Не удалось прочитать журнал паллет: '+e.message+'. Не перезаписывайте повреждённые данные до восстановления из JSON.'}
 const current=()=>book.sessions.find(s=>s.id===currentId)||null;
 const getInvoices=()=>(ops.invoices||[]).filter(i=>i&&!i.isOpening&&(i.id||i.number||i.tracking)&&i.supplierId);
 const invoiceByKey=key=>getInvoices().find(i=>palletInvoiceKey(i)===key);
 const say=(message,error=false)=>{const slot=$('plInfo');slot.textContent=message;slot.style.color=error?'#b13746':'#17614b'};
 const blocked=()=>{if(!infoError)return false;say(infoError,true);return true};
 const persist=(next,allowRecovery=false)=>{
  const raw=JSON.stringify(next);
  try{
   if(!allowRecovery&&localStorage.getItem(PALLET_STORAGE_KEY)!==savedRaw)
    throw Error('Журнал был изменён в другой вкладке. Не перезаписывайте его: перезагрузите LANDA, чтобы увидеть последние записи.');
   localStorage.setItem(PALLET_STORAGE_KEY,raw);
   if(localStorage.getItem(PALLET_STORAGE_KEY)!==raw)throw Error('Хранилище не подтвердило запись');
   savedRaw=raw;book=next;return true;
  }catch(e){say('Не удалось сохранить приёмку: '+e.message+'. Проверь память браузера.',true);return false}
 };
 const download=(value,file,type)=>{
  const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');
  a.download=file;a.href=url;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
 };
 const uniqueSuffix=items=>{
  const seen=new Map();
  for(const i of items){const key=palletShortNumber(i);seen.set(key,(seen.get(key)||0)+1)}
  return i=>{
   const tail=palletShortNumber(i);
   if((seen.get(tail)||0)<2)return '№ …'+tail;
   const all=String(i.number||i.tracking||i.key),digits=all.replace(/\D/g,'');
   const extended=digits.slice(-8)||all.slice(-8);
   const similar=items.filter(x=>{
    const other=String(x.number||x.tracking||x.key),d=other.replace(/\D/g,'');
    return (d.slice(-8)||other.slice(-8))===extended&&x.supplierId===i.supplierId;
   });
   return '№ …'+extended+(similar.length>1?' · ID '+String(i.key||palletInvoiceKey(i)).slice(-6):'');
  };
 };
 function listedInvoices(){
  const s=current(),q=$('plSearch').value.toLocaleLowerCase('ru-RU').trim(),status=$('plStatus').value,n=names();
  const picked=new Set((s?.invoices||[]).map(i=>i.key));
  return getInvoices().filter(i=>{
   const key=palletInvoiceKey(i),selected=picked.has(key);
   if(status!=='all'&&!selected){
    const st=i.status==='received'?'delivered':String(i.status||'created');
    if(st!==status)return false;
   }
   if(q&&!([i.number,i.tracking,i.id,i.supplierId,n[i.supplierId],palletShortNumber(i)].join(' ').toLocaleLowerCase('ru-RU').includes(q)))return false;
   return true;
  }).sort((a,b)=>{
   const x=picked.has(palletInvoiceKey(a))?0:1,y=picked.has(palletInvoiceKey(b))?0:1;
   return x-y||String(b.date||'').localeCompare(String(a.date||''))||
    String(a.number||'').localeCompare(String(b.number||''));
  });
 }
 function renderInvoices(){
  const s=current(),items=listedInvoices(),lookup=uniqueSuffix([...getInvoices(),...(s?.invoices||[])]);
  const picked=new Set((s?.invoices||[]).map(i=>i.key)),n=names();
  $('plChooseBlock').hidden=!s;
  $('plInvoices').innerHTML=items.slice(0,searchLimit).map(i=>{
   const key=palletInvoiceKey(i),selected=picked.has(key),title=lookup(i),supplier=n[i.supplierId]||i.supplierId;
   return '<label class="pl-invoice '+(selected?'checked':'')+'" title="'+esc(String(i.number||i.tracking||i.id))+'">'+
    '<input type="checkbox" data-pl-invoice="'+esc(key)+'" '+(selected?'checked':'')+' '+(s?.closed?'disabled':'')+'>'+
    '<span><b>'+esc(title)+'</b> · '+esc(supplier)+
    '<span class="pl-muted">'+esc(i.date||'')+' · '+esc(labels[i.status]||i.status||'')+' · позиций в накладной: '+(i.items?.length||0)+'</span></span></label>';
  }).join('')||'<div class="pl-muted">Накладных по выбранному фильтру нет. Переключи статус на «Все статусы» или дождись загрузки актуальных накладных из LANDA.</div>';
  $('plMore').hidden=items.length<=searchLimit;
  $('plInvoicesMessage').textContent='Найдено накладных: '+items.length+'; показано: '+Math.min(searchLimit,items.length)+'. Выбрано в этой приёмке: '+(s?.invoices?.length||0)+'.';
 }
 function renderSessions(){
  const s=current();
  $('plSessions').innerHTML=book.sessions.slice().reverse().map(x=>
   '<option value="'+esc(x.id)+'" '+(x.id===currentId?'selected':'')+'>'+
   esc(x.name)+' · '+(x.closed?'завершена':'в работе')+' · '+x.entries.length+' записей</option>').join('')||
   '<option value="">Нет приёмок — нажми «Новая приёмка»</option>';
  $('plCloseSession').disabled=!s;
  $('plCloseSession').textContent=s?.closed?'↶ Возобновить':'✓ Завершить';
  $('plExportCSV').disabled=!s;
  $('plEnterBlock').hidden=!s;
  $('plEntryForm').querySelectorAll('input,select,button').forEach(el=>el.disabled=!s||s.closed);
  const label=uniqueSuffix(s?.invoices||[]),n=names();
  const active=s?.invoices?.some(i=>i.key===activeInvoice);
  if(!active)activeInvoice=s?.invoices?.[0]?.key||'';
  $('plCurrentInvoice').innerHTML=(s?.invoices||[]).map(i=>
   '<option value="'+esc(i.key)+'" '+(i.key===activeInvoice?'selected':'')+'>'+
   esc(label(i))+' · '+esc(n[i.supplierId]||i.supplierId)+'</option>').join('')||
   '<option value="">Сначала отметьте накладную</option>';
  $('plSaveEntry').disabled=!s||s.closed||!s.invoices.length;
  if(s){
   const summary=palletSummary(s),total=summary.reduce((v,x)=>v+x.places,0);
   const expected=summary.filter(x=>x.expectedPlaces!==null);
   const mismatches=expected.filter(x=>x.differencePlaces!==0).length;
   $('plOverview').innerHTML='<span>Накладных: <b>'+s.invoices.length+'</b></span>'+
    '<span>Записей: <b>'+s.entries.length+'</b></span><span>В машину: <b>'+fmt(total)+' мест</b></span>'+
    '<span>Расхождение по местам: <b>'+mismatches+' накладных</b> (из '+expected.length+' с планом)</span>'+
    (s.closed?'<span class="pl-good">✓ Завершена</span>':'<span class="pl-warning">● В работе</span>');
  }else $('plOverview').innerHTML='<span>Создай приёмку, чтобы начать запись мест</span>';
  renderSuggestions();
 }
 function renderSuggestions(){
  const s=current();
  if(!s){$('plProductHints').innerHTML='';$('plSuggestions').innerHTML='';return}
  const q=$('plProduct').value;
  const dictionary=palletSuggestions(book,s.invoices,activeInvoice,q);
  $('plProductHints').innerHTML=dictionary.map(x=>'<option value="'+esc(x)+'"></option>').join('');
  $('plSuggestions').innerHTML=dictionary.slice(0,6).map(x=>
   '<button type="button" class="rc-btn" data-pl-suggest="'+esc(x)+'">'+esc(x)+'</button>').join('');
 }
 function renderLog(){
  const s=current();if(!s){$('plLog').innerHTML='<p class="pl-muted">Записей пока нет.</p>';return}
  const n=names(),lookup=uniqueSuffix(s.invoices),invoiceMap=new Map(s.invoices.map(i=>[i.key,i]));
  $('plLog').innerHTML=s.entries.length?'<table class="pl-table"><thead><tr><th>№</th><th>Накладная</th><th>Что загрузил</th><th>Мест</th><th>Штук</th><th>Время</th><th></th></tr></thead><tbody>'+
   s.entries.map((e,index)=>{
    const i=invoiceMap.get(e.invoiceKey);
    return '<tr><td>'+(index+1)+'</td><td><strong>'+esc(i?lookup(i):'—')+'</strong><div class="pl-muted">'+esc(n[i?.supplierId]||i?.supplierId||'')+'</div></td>'+
     '<td>'+esc(e.product)+'</td><td><strong>'+fmt(e.places)+'</strong></td><td>'+(e.units===null?'—':fmt(e.units))+'</td>'+
     '<td>'+esc(timestamp(e.at))+'</td><td><div class="pl-actions"><button type="button" class="rc-btn" data-pl-edit="'+esc(e.id)+'" '+(s.closed?'disabled':'')+'>Исправить</button>'+
     '<button type="button" class="rc-btn" data-pl-delete="'+esc(e.id)+'" '+(s.closed?'disabled':'')+'>×</button></div></td></tr>';
   }).join('')+'</tbody></table>':'<p class="pl-muted">Записей пока нет. Добавь первое фактически загруженное место в форме выше.</p>';
 }
 function renderReport(){
  const s=current();if(!s){$('plReport').innerHTML='';return}
  const summaries=palletSummary(s),n=names(),lookup=uniqueSuffix(s.invoices);
  $('plReport').innerHTML=summaries.length?'<div class="pl-scroll"><table class="pl-table"><thead><tr>'+
   '<th>Накладная</th><th>Фактически мест</th><th>Ожидается мест</th><th>Расхождение</th><th>Разных позиций</th><th>Сверка товаров, шт.</th></tr></thead><tbody>'+
   summaries.map(v=>{
    const diff=v.differencePlaces,prefix=diff===null?'—':diff===0?'✓ 0':(diff>0?'+':'')+fmt(diff);
    const units=v.actualUnits===null?'не подсчитано':fmt(v.actualUnits)+' / '+fmt(v.expectedUnits);
    return '<tr><td><strong>'+esc(lookup(v))+'</strong><div class="pl-muted">'+esc(n[v.supplierId]||v.supplierId)+'</div></td>'+
     '<td><strong>'+fmt(v.places)+'</strong> · '+v.entries+' записей</td><td>'+
     '<input type="number" min="1" step="1" class="pl-expected" style="max-width:105px" data-pl-expected="'+esc(v.key)+'" value="'+(v.expectedPlaces??'')+'" placeholder="Нет данных" '+(s.closed?'disabled':'')+'></td>'+
     '<td class="'+(diff===null?'pl-muted':diff===0?'pl-good':'pl-alert')+'">'+prefix+'</td>'+
     '<td>'+v.positions+'</td><td>'+units+'<div class="pl-muted">План: '+fmt(v.expectedUnits)+' шт.; места считаются отдельно</div></td></tr>';
   }).join('')+'</tbody></table></div><div class="pl-final-list">'+summaries.map(v=>
    '<details class="pl-final"><summary>'+esc(lookup(v))+' · '+esc(n[v.supplierId]||v.supplierId)+' — '+fmt(v.places)+' мест / '+v.positions+' позиций</summary>'+
    '<ul>'+(v.products.length?v.products.map(g=>
     '<li><strong>'+esc(g.name)+'</strong> · '+fmt(g.places)+' мест'+(g.units===null?'':' · '+fmt(g.units)+' шт.')+'</li>').join(''):
     '<li>Пока нет фактически забранных мест</li>')+'</ul></details>').join('')+'</div>':
    '<p class="pl-muted">Пока не выбраны накладные для приёмки.</p>';
 }
 function render(){
  if(!panel.isConnected)return;
  renderSessions();renderInvoices();renderLog();renderReport();
  if(infoError)say(infoError,true);
 }
 function open(){
  panel.hidden=false;render();
 }
 function hide(){panel.hidden=true}
 function make(){
  if(blocked())return;
  const at=new Date().toISOString(),id='pallet-'+crypto.randomUUID();
  try{
   const b=palletCreate(book,id,at,'Приёмка '+timestamp(at));
   if(!persist(b))return;
   currentId=id;activeInvoice='';editingEntry='';$('plProduct').value='';$('plPlaces').value='1';$('plUnits').value='';
   $('plSearch').value='';$('plStatus').value='ready';searchLimit=36;
   render();say('Приёмка создана. Отметь накладные и начинай загружать места.');
  }catch(e){say(e.message,true)}
 }
 function store(next,done){
  if(!persist(next))return;
  render();say(done||'✓ Сохранено.');return true;
 }
 $('plNew').addEventListener('click',make);
 $('plSessions').addEventListener('change',e=>{
  currentId=e.target.value;activeInvoice='';editingEntry='';$('plProduct').value='';$('plPlaces').value='1';$('plUnits').value='';
  render();
 });
 $('plCloseSession').addEventListener('click',()=>{
  const s=current();if(!s||blocked())return;
  if(!s.closed&&!confirm('Завершить приёмку «'+s.name+'»? После завершения запись блокируется. При необходимости её можно возобновить.'))return;
  try{store(palletClose(book,s.id,!s.closed),s.closed?'Приёмка снова открыта для исправлений.':'Приёмка завершена. Сохраните итог CSV или архив JSON.')}catch(e){say(e.message,true)}
 });
 $('plSearch').addEventListener('input',()=>{searchLimit=36;renderInvoices()});
 $('plStatus').addEventListener('change',()=>{searchLimit=36;renderInvoices()});
 $('plMore').addEventListener('click',()=>{searchLimit+=60;renderInvoices()});
 $('plInvoices').addEventListener('change',e=>{
  const t=e.target.closest('[data-pl-invoice]'),s=current();if(!t||!s||blocked())return;
  const source=invoiceByKey(t.dataset.plInvoice);if(!source){say('Накладная не найдена в текущей базе LANDA.',true);renderInvoices();return}
  try{
   const result=palletSelect(book,s.id,source,t.checked);
   if(!persist(result)){renderInvoices();return}
   if(t.checked)activeInvoice=palletInvoiceKey(source);
   render();say(t.checked?'Накладная добавлена в список приёмки.':'Накладная исключена.');
  }catch(err){say(err.message,true);renderInvoices()}
 });
 $('plCurrentInvoice').addEventListener('change',e=>{activeInvoice=e.target.value;renderSuggestions();$('plProduct').focus()});
 $('plProduct').addEventListener('input',renderSuggestions);
 $('plSuggestions').addEventListener('click',e=>{
  const t=e.target.closest('[data-pl-suggest]');if(!t)return;
  $('plProduct').value=t.dataset.plSuggest;$('plProduct').focus();renderSuggestions();
 });
 $('plEntryForm').addEventListener('submit',e=>{
  e.preventDefault();if(blocked())return;
  const s=current();if(!s||s.closed)return;
  const entry={invoiceKey:$('plCurrentInvoice').value,product:$('plProduct').value,
   places:$('plPlaces').value,units:$('plUnits').value,at:new Date().toISOString()};
  try{
   const result=editingEntry?
    palletEditEntry(book,s.id,editingEntry,entry):
    palletAdd(book,s.id,{...entry,id:'place-'+crypto.randomUUID()});
   if(!persist(result))return;
   editingEntry='';$('plSaveEntry').textContent='＋ Добавить в машину';
   $('plProduct').value='';$('plPlaces').value='1';$('plUnits').value='';
   activeInvoice=entry.invoiceKey;
   render();say('✓ Фактическое место записано: '+entry.product+'. Можно продолжать с этой или другой накладной.');
   $('plProduct').focus();
  }catch(err){say(err.message,true)}
 });
 $('plLog').addEventListener('click',e=>{
  const remove=e.target.closest('[data-pl-delete]'),edit=e.target.closest('[data-pl-edit]'),s=current();
  if(!s||s.closed||blocked()||(!remove&&!edit))return;
  const id=(remove||edit).dataset[remove?'plDelete':'plEdit'],entry=s.entries.find(x=>x.id===id);
  if(!entry)return;
  if(remove){
   if(!confirm('Удалить запись «'+entry.product+'» ('+entry.places+' мест)?'))return;
   try{store(palletRemoveEntry(book,s.id,id),'Запись удалена из приёмки.')}catch(err){say(err.message,true)}
  }else{
   editingEntry=id;activeInvoice=entry.invoiceKey;
   $('plProduct').value=entry.product;$('plPlaces').value=entry.places;$('plUnits').value=entry.units??'';
   renderSessions();$('plSaveEntry').textContent='✓ Сохранить исправление';
   $('plEntryForm').scrollIntoView({behavior:'smooth',block:'start'});$('plProduct').focus();
   say('Исправляешь запись №'+(s.entries.indexOf(entry)+1)+'. При сохранении её место в журнале не изменится.');
  }
 });
 $('plReport').addEventListener('change',e=>{
  const input=e.target.closest('[data-pl-expected]'),s=current();if(!input||!s||blocked())return;
  try{store(palletExpected(book,s.id,input.dataset.plExpected,input.value),'Ожидаемое число мест записано.')}catch(err){say(err.message,true);renderReport()}
 });
 $('plExportCSV').addEventListener('click',()=>{
  const s=current();if(!s)return;
  download(palletCSV(s),'LANDA-СДЭК-приёмка-'+day()+'.csv','text/csv;charset=utf-8');
 });
 $('plExportJSON').addEventListener('click',()=>{
  if(blocked())return;
  download(JSON.stringify(book,null,2),'LANDA-СДЭК-архив-приёмок-'+day()+'.json','application/json;charset=utf-8');
 });
 $('plImportJSON').addEventListener('click',()=>$('plImportFile').click());
 $('plImportFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{
   if(file.size>10000000)throw Error('Архив слишком большой (максимум 10 МБ)');
   const data=palletValidate(JSON.parse(await file.text()));
   if(!confirm('ЗАМЕНИТЬ местный архив ('+book.sessions.length+' приёмок) на '+data.sessions.length+' приёмок из файла? Перед заменой сохраните свой архив JSON.'))return;
   // Allow a valid import to recover from a corrupted local file.
   if(!persist(data,true))return;
   infoError='';currentId=data.sessions.at(-1)?.id||'';activeInvoice='';editingEntry='';
   render();say('✓ Архив приёмок загружен. Действующие накладные и финансы не изменены.');
  }catch(err){say('Ошибка импорта: '+err.message,true)}
 });
 window.LANDA_PALLET={open,hide,render,storageKey:PALLET_STORAGE_KEY};
 const active=book.sessions.filter(s=>!s.closed);
 currentId=active.at(-1)?.id||book.sessions.at(-1)?.id||'';
}