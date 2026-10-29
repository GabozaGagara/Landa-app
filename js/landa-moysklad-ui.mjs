// Read-only integration UI. Only manual mapping preferences are stored locally.
// Never changes ops, financial backups, MoySklad documents, or warehouse quantities.
import {collectDelivered,productLinkKey,compareSelected,candidates,aggregateLines} from './landa-moysklad-match.mjs';

if(typeof document!=='undefined'&&typeof ops!=='undefined'){
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=x=>Number(x).toLocaleString('ru-RU',{maximumFractionDigits:4});
 const KEY='landa_moysklad_name_links_v1';
 const isoDate=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 let links={},payload=null,chosenDocs=new Set(),chosenInvoices=new Set(),busy=false;
 try{const parsed=JSON.parse(localStorage.getItem(KEY)||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))links=parsed;}catch(_){}
 const css=document.createElement('style');
 css.textContent=[
 '.msdlg{width:min(1180px,calc(100vw - 18px));max-height:94dvh;border:0;border-radius:17px;padding:0;color:#233750;background:#fff;box-shadow:0 25px 80px #14203c50}',
 '.msdlg::backdrop{background:#10203b96}.msdlg *{box-sizing:border-box}',
 '.msdlg header{padding:17px 21px;background:#142944;color:white;display:flex;align-items:center;justify-content:space-between;gap:12px}',
 '.msdlg header h2{color:white;margin:0;font-size:20px}.msbody{padding:19px 21px 28px}',
 '.msinfo{font-size:12px;color:#64768e;line-height:1.55}.mswarn{padding:12px;background:#fff4df;border-radius:9px;font-size:12px;color:#765120;margin:12px 0}',
 '.mscontrols{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:9px;align-items:end;margin:15px 0}',
 '.mscontrols label{display:block;font-size:12px;font-weight:600}.msdlg input,.msdlg select{display:block;width:100%;padding:9px;margin-top:5px;min-width:0;border:1px solid #cbd7e5;border-radius:8px;background:#fff;color:#1d344c;font:inherit}',
 '.msbtn{border:1px solid #c8d6e6;background:white;border-radius:9px;padding:9px 13px;cursor:pointer;font-weight:600;color:#245080;font-size:13px}',
 '.msprimary{background:#315ed2;border-color:#315ed2;color:white}.msbtn:disabled{opacity:.5;cursor:not-allowed}',
 '.msflex{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.msrow{display:flex;align-items:center;gap:8px;padding:9px 3px;border-bottom:1px solid #ecf0f6;font-size:13px}',
 '.msrow input[type=checkbox]{flex:none;width:18px;height:18px;margin:0}.msrow label{flex:1;cursor:pointer}.msrow small{display:block;color:#64768b;margin-top:2px}',
 '.mscols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:17px 0}',
 '.msbox{border:1px solid #dce5f0;border-radius:12px;padding:12px;min-width:0;max-height:310px;overflow:auto}',
 '.msbox h3{margin:0 0 8px;color:#203c60;font-size:15px}.msline{border:1px solid #dce5f0;border-radius:10px;padding:12px;margin:10px 0}',
 '.msline-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.msline-title{font-size:14px;font-weight:700}',
 '.msmetrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.msmetric{background:#f2f6fc;padding:9px 12px;border-radius:8px;font-size:12px}',
 '.msstate{font-weight:700;font-size:12px}.msok{color:#107555}.msbad{color:#ae3447}.msmuted{color:#68798e}',
 '.msline select{max-width:100%;margin:9px 0}.msextras{background:#f6f9fc;padding:12px;border-radius:10px;margin:11px 0}',
 '@media(max-width:690px){.mscols{grid-template-columns:1fr}.msdlg header{padding:12px 14px}.msbody{padding:12px 14px}.msdlg header h2{font-size:17px}}'
 ].join('');
 document.head.append(css);
 const dialog=document.createElement('dialog');dialog.className='msdlg';dialog.id='landaMoyskladDialog';
 dialog.setAttribute('aria-label','Сверка приёмок МойСклад с накладными LANDA');
 dialog.innerHTML=[
  '<header><h2>↔ Сверка приёмок «МойСклад»</h2><button class="msbtn" id="msClose" type="button">Закрыть ×</button></header>',
  '<div class="msbody"><p class="msinfo">Выберите период приёмок, поставщика LANDA и конкретные документы. Сравниваются только накладные с текущим статусом «Вручен». Дата отправки не является подтверждением фактической даты вручения.</p>',
  '<div class="mswarn">Только чтение из «МоегоСклада». Сопоставления товаров хранятся локально в этом браузере; финансовые данные LANDA и приёмки не изменяются. Для доступа нужен отдельный серверный код владельца.</div>',
  '<div class="mscontrols">',
  '<label>Поставщик LANDA<select id="msSupplier"></select></label>',
  '<label>Приёмки с<input id="msFrom" type="date"></label>',
  '<label>По дату<input id="msTo" type="date"></label>',
  '<label>Код владельца Cloudflare<input id="msAdmin" type="password" autocomplete="off" placeholder="LANDA_MS_ADMIN_KEY"></label>',
  '</div>',
  '<div class="msflex"><button class="msbtn" id="msCheck" type="button">✓ Проверить подключение</button><button class="msbtn msprimary" id="msLoad" type="button">↻ Загрузить приёмки</button>',
  '<button class="msbtn" id="msCompare" type="button">Сверить выбранное</button>',
  '<button class="msbtn" id="msCSV" type="button">↓ Отчёт CSV</button></div>',
  '<p id="msMessage" class="msinfo" role="status" aria-live="polite"></p>',
  '<div class="mscols"><div class="msbox"><h3>Накладные LANDA · Вручены</h3><p class="msinfo">Отметьте отправления, которые действительно принимали в выбранных приёмках.</p><div id="msInvoices"></div></div>',
  '<div class="msbox"><h3>Проведённые приёмки «МойСклад»</h3><p class="msinfo">Отметьте соответствующие документы приёмки. Они могут быть оформлены позже доставки СДЭК.</p><div id="msDocuments"><p class="msinfo">Загрузите данные после настройки Cloudflare.</p></div></div></div>',
  '<div id="msSummary" class="msmetrics"></div><div id="msResults"></div>',
  '</div>'
 ].join('');
 document.body.append(dialog);
 const btn=document.createElement('button');btn.type='button';btn.className='nav-btn core';
 btn.innerHTML='<span class="nav-icon">⇄</span><span class="nav-text">Приёмка · МойСклад</span>';
 const nav=document.querySelector('.op-nav');
 nav?.querySelector('#rcNavOpen')?.after(btn);
 if(!btn.parentNode)nav?.append(btn);
 function currentSupplier(){return $('msSupplier').value;}
 function invoices(){
  return (ops.invoices||[]).filter(i=>!i.isOpening&&i.supplierId===currentSupplier()&&['delivered','received'].includes(i.status)
   &&String(i.date||'').slice(0,10)<=$('msTo').value);
 }
 function validInvoiceRows(){
  return collectDelivered(ops.invoices||[],currentSupplier(),$('msTo').value).filter(r=>chosenInvoices.has(r.invoiceId));
 }
 function selectedDocs(){return (payload?.documents||[]).filter(d=>chosenDocs.has(d.id));}
 function availableProducts(){
  const map=new Map();
  for(const d of selectedDocs())for(const p of d.positions||[])if(p.productId&&!map.has(p.productId))
   map.set(p.productId,{id:p.productId,name:p.name,sku:p.sku,article:p.article,code:p.code});
  return [...map.values()];
 }
 function message(s,bad=false){$('msMessage').textContent=s;$('msMessage').style.color=bad?'#b13c45':'#506780';}
 function renderInvoices(){
  $('msInvoices').innerHTML=invoices().map(i=>
   '<div class="msrow"><input id="ms-inv-'+esc(i.id)+'" type="checkbox" data-invoice="'+esc(i.id)+'" '+(chosenInvoices.has(String(i.id))?'checked':'')+'>'+
   '<label for="ms-inv-'+esc(i.id)+'"><b>'+esc(i.number||i.tracking||i.id)+'</b> · '+esc(i.date||'')+
   '<small>'+esc((i.items||[]).map(x=>x.name+' × '+x.qty).join(' / ').slice(0,200))+'</small></label></div>'
  ).join('')||'<p class="msinfo">В текущих данных LANDA нет вручённых накладных этого поставщика с датой отправки не позднее выбранного дня. Проверьте статус и обновление облачной копии.</p>';
 }
 function renderDocs(){
  $('msDocuments').innerHTML=(payload?.documents||[]).map(d=>{
   const total=(d.positions||[]).reduce((n,p)=>n+Number(p.quantity||0),0);
   return '<div class="msrow"><input id="ms-doc-'+esc(d.id)+'" type="checkbox" data-doc="'+esc(d.id)+'" '+(chosenDocs.has(d.id)?'checked':'')+'>'+
    '<label for="ms-doc-'+esc(d.id)+'"><b>'+esc(d.name||d.id)+'</b> · '+esc(d.date)+
    '<small>'+esc(d.agent||'Контрагент не указан')+' · '+(d.positions||[]).length+' поз. / '+num(total)+' шт.'+(d.store?' · '+esc(d.store):'')+'</small></label></div>';
  }).join('')||'<p class="msinfo">За выбранные даты проведённых приёмок не найдено.</p>';
 }
 function report(){
  const rows=validInvoiceRows(),docs=selectedDocs();
  return compareSelected(rows,docs,links,currentSupplier());
 }
 function renderResult(){
  const rows=validInvoiceRows(),docs=selectedDocs(),data=report(),productList=availableProducts();
  const good=data.results.filter(r=>r.state==='matched').length,bad=data.results.filter(r=>r.state==='difference'||r.state==='shared').length,
   pending=data.results.filter(r=>r.state==='unmatched').length;
  $('msSummary').innerHTML=[
   '<span class="msmetric">Накладных: <b>'+chosenInvoices.size+'</b></span>',
   '<span class="msmetric">Приёмок: <b>'+docs.length+'</b></span>',
   '<span class="msmetric">Совпадает: <b>'+good+'</b></span>',
   '<span class="msmetric">Расхождения: <b>'+bad+'</b></span>',
   '<span class="msmetric">Не сопоставлено: <b>'+pending+'</b></span>'
  ].join('');
  if(!rows.length||!docs.length){$('msResults').innerHTML='<p class="mswarn">Выберите хотя бы одну вручённую накладную LANDA и одну проведённую приёмку «МоегоСклада».</p>';return}
  $('msResults').innerHTML='<h3>Сравнение товаров</h3>'+data.results.map(g=>{
   const key=productLinkKey(currentSupplier(),g.name,g.sku);
   const mapped=links[key]||'';
   const guess=candidates(g,productList,mapped);
   const status=g.state==='matched'?'✓ Совпадает':g.state==='difference'?'⚠ Расхождение':
    g.state==='shared'?'⚠ Общий товар в нескольких строках':'? Требуется сопоставление';
   const style=g.state==='matched'?'msok':g.state==='unmatched'?'msmuted':'msbad';
   const options=['<option value="">— Не связывать —</option>',...productList.slice().sort((a,b)=>{
    const ca=guess.suggestions.find(v=>v.id===a.id)?.score||0,cb=guess.suggestions.find(v=>v.id===b.id)?.score||0;
    return cb-ca||a.name.localeCompare(b.name,'ru');
   }).map(p=>'<option value="'+esc(p.id)+'" '+(mapped===p.id?'selected':'')+'>'+esc(p.name)+' · '+esc(p.sku||'без артикула')+'</option>')];
   const suggested=g.match?'Связано: '+g.match.name+(g.match.method==='manual'?' (вы подтверждали)':' (найдено автоматически)'):
    g.candidate?'Предлагается: '+g.candidate.name+' — подтвердите соответствие при необходимости':'Совпадений не найдено';
   const amount=g.state==='shared'?'Ожидалось по общему товару: '+num(g.sharedExpected)+'; общее расхождение: '+num(g.sharedDifference):
    'Фактически: '+(g.received===null?'—':num(g.received))+' · Разница: '+(g.delta===null?'—':(g.delta>0?'+':'')+num(g.delta));
   return '<div class="msline"><div class="msline-top"><div><div class="msline-title">'+esc(g.name)+'</div>'+
    '<div class="msinfo">'+esc(g.sku||'без артикула')+' · накладные: '+esc(g.invoices.join(', '))+'</div></div>'+
    '<div><b>Заявлено: '+num(g.expected)+' шт.</b><div class="msstate '+style+'">'+status+'</div></div></div>'+
    '<p class="msinfo">'+esc(suggested)+' · '+esc(amount)+'</p><label class="msinfo">Связать с товаром «МоегоСклада»'+
    '<select data-ms-map="'+encodeURIComponent(key)+'">'+options.join('')+'</select></label></div>';
  }).join('')+
  (data.unmatchedProducts.length?'<div class="msextras"><b>Товары приёмки без соответствия в выбранных накладных:</b>'+
   '<p class="msinfo">Это не обязательно излишек: проверьте, не включены ли в приёмку другие поставки.</p>'+
   data.unmatchedProducts.map(p=>'<div class="msrow">'+esc(p.name)+' · '+num(p.received)+' шт.</div>').join('')+'</div>':'');
 }
 function open(){
  $('msSupplier').innerHTML=(ops.suppliers||[]).map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name||s.id)+'</option>').join('');
  if(!$('msTo').value){
   const d=new Date();$('msTo').value=isoDate(d);d.setDate(d.getDate()-14);$('msFrom').value=isoDate(d);
  }
  chosenInvoices.clear();chosenDocs.clear();payload=null;
  $('msAdmin').value='';
  if(typeof closeMobile==='function')closeMobile();
  dialog.showModal();renderInvoices();renderDocs();renderResult();
  message('Сначала настройте серверные секреты в Cloudflare. Ключ владельца не сохраняется в браузере.');
 }
 function endpoint(route='moysklad-supplies'){
  if(!['moysklad-check','moysklad-supplies'].includes(route))throw Error('Неверная операция');
  const raw=($('supplierWorkerUrl')?.value||'https://landa-app.kamily1997.workers.dev').trim().replace(/\/+$/,'');
  const url=new URL(raw);
  if(url.protocol!=='https:')throw Error('Укажите HTTPS-адрес Cloudflare Worker');
  return url.origin+url.pathname.replace(/\/+$/,'')+'/admin/'+route;
 }
 async function checkConnection(){
  if(busy)return;
  const code=$('msAdmin').value;
  if(code.length<32){message('Введите код владельца для проверки подключения (не менее 32 символов).',true);return;}
  busy=true;$('msCheck').disabled=true;
  message('Проверяем доступ к API «МоегоСклада» без чтения накладных и без записи данных…');
  try{
   const response=await fetch(endpoint('moysklad-check'),{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({adminKey:code}),cache:'no-store'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(response.status===404?
    'Cloudflare Worker ещё не обновлён. Проверьте Deployments → Ready.':
    (data.error||'Сервер вернул HTTP '+response.status));
   if(data.ok!==true)throw Error('Сервер не подтвердил подключение.');
   message('✓ Подключение к «МоемуСкладу» работает. Доступ к чтению приёмок подтверждён. Теперь выберите период и нажмите «Загрузить приёмки».');
  }catch(e){message('Проверка подключения не прошла: '+e.message,true);}
  finally{busy=false;$('msCheck').disabled=false;}
 }
 async function load(){
  if(busy)return;
  const code=$('msAdmin').value;
  if(code.length<32){message('Введите отдельный код владельца LANDA из секретов Cloudflare (не менее 32 символов).',true);return}
  const from=$('msFrom').value,to=$('msTo').value;
  if(!from||!to||from>to||Math.round((Date.parse(to)-Date.parse(from))/86400000)>31){
   message('Укажите период приёмок до 32 календарных дней включительно.',true);return;
  }
  busy=true;$('msLoad').disabled=true;payload=null;chosenDocs.clear();renderDocs();renderResult();message('Читаем проведённые приёмки через защищённый Worker…');
  try{
   const r=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({adminKey:code,from,to}),cache:'no-store'});
   const result=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(result.error||('HTTP '+r.status));
   if(!Array.isArray(result.documents))throw Error('Неверный ответ сервера');
   payload=result;renderDocs();renderResult();
   message('Загружено приёмок: '+result.documents.length+'. Отметьте нужные документы. Данные не записывались в LANDA.');
  }catch(e){message('Не удалось загрузить приёмки: '+e.message,true)}
  finally{busy=false;$('msLoad').disabled=false}
 }
 function csvCell(v){
  let s=String(v??'');if(typeof v==='string'&&/^\s*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
 }
 function exportCSV(){
  const res=report(),rows=[['Товар LANDA','Артикул LANDA','Заявлено, шт.','Товар МойСклад','Принято, шт.','Разница','Результат','Накладные']];
  for(const g of res.results)rows.push([g.name,g.sku,g.expected,g.match?.name||'',g.received??'',g.delta??'',g.state,g.invoices.join('; ')]);
  for(const p of res.unmatchedProducts)rows.push(['','','',p.name,p.received,'','Товар приёмки не сопоставлен','']);
  if(rows.length===1){message('Нет данных для экспорта.',true);return}
  const blob=new Blob(['\ufeff'+rows.map(x=>x.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),
   url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='LANDA-МойСклад-сверка-'+$('msTo').value+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
 }
 btn.addEventListener('click',open);
 $('msClose').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{$('msAdmin').value='';payload=null;chosenDocs.clear();});
 $('msCheck').addEventListener('click',checkConnection);
 $('msLoad').addEventListener('click',load);$('msCompare').addEventListener('click',renderResult);
 $('msCSV').addEventListener('click',exportCSV);
 $('msSupplier').addEventListener('change',()=>{chosenInvoices.clear();renderInvoices();renderResult()});
 $('msTo').addEventListener('change',()=>{chosenInvoices.clear();chosenDocs.clear();payload=null;renderInvoices();renderDocs();renderResult()});
 $('msFrom').addEventListener('change',()=>{chosenDocs.clear();payload=null;renderDocs();renderResult()});
 $('msInvoices').addEventListener('change',e=>{
  const id=e.target.dataset.invoice;if(!id)return;
  if(e.target.checked)chosenInvoices.add(id);else chosenInvoices.delete(id);renderResult();
 });
 $('msDocuments').addEventListener('change',e=>{
  const id=e.target.dataset.doc;if(!id)return;
  if(e.target.checked)chosenDocs.add(id);else chosenDocs.delete(id);renderResult();
 });
 $('msResults').addEventListener('change',e=>{
  if(!e.target.matches('[data-ms-map]'))return;
  let key;try{key=decodeURIComponent(e.target.dataset.msMap)}catch(_){return}
  const newId=e.target.value,old=links[key]||'';
  if(newId&&!confirm('Подтвердить связь товара поставщика с выбранным товаром из «МоегоСклада»?')){e.target.value=old;return}
  if(newId)links[key]=newId;else delete links[key];
  try{localStorage.setItem(KEY,JSON.stringify(links));message('Соответствие сохранено локально. Финансовые данные не изменены.')}
  catch(e){if(old)links[key]=old;else delete links[key];message('Не удалось сохранить связь: '+e.message,true)}
  renderResult();
 });
 window.addEventListener('landa:data-changed',()=>{if(dialog.open){renderInvoices();renderResult()}});
 window.LANDA_MOYSKLAD={open};
}
