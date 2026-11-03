// LANDA standalone expense journal: date + amount + free-text description.
// No writes to financial operations, supplier balances, cash, invoices or proschet.
import {
 EXPENSES_STORAGE_KEY,EXPENSE_CURRENCIES,newExpenseBook,readExpenseBook,
 addExpense,editExpense,removeExpense,expensesFiltered,expenseTotals,expenseSeries,expenseCSV
} from './landa-expenses-core.mjs';

if(typeof document!=='undefined'&&document.getElementById('expensesPage')){
 const $=id=>document.getElementById(id);
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currencies={RUB:'₽',USD:'$',BYN:'Br',EUR:'€'};
 const methods={cash:'Наличные',card:'Карта',transfer:'Перевод',other:'Другое'};
 const money=(cents,currency)=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+(currencies[currency]||currency);
 const short=(cents,currency)=>{
  const value=cents/100;
  const n=value>=1000000?(value/1000000).toLocaleString('ru-RU',{maximumFractionDigits:1})+' млн':
   value>=1000?(value/1000).toLocaleString('ru-RU',{maximumFractionDigits:1})+' тыс':
   value.toLocaleString('ru-RU',{maximumFractionDigits:0});
  return n+' '+(currencies[currency]||currency);
 };
 const today=()=>{const d=new Date(),p=x=>String(x).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())};
 const style=document.createElement('style');style.textContent=[
  '.exp-layout{display:grid;grid-template-columns:minmax(260px,380px) minmax(0,1fr);gap:15px;align-items:start;margin:15px 0 30px}',
  '.exp-entry,.exp-journal,.exp-chart{padding:19px;min-width:0}',
  '.exp-entry h2,.exp-journal h2,.exp-chart h2{font-size:17px;margin:0 0 14px;color:#223e61}',
  '.exp-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
  '.exp-fields label,.exp-filters label{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:12px;color:#475c78;font-weight:650}',
  '.exp-fields .exp-full{grid-column:1/-1}.exp-fields input,.exp-fields textarea,.exp-filters input,.exp-filters select{font:inherit;font-size:13px;padding:10px;border:1px solid #cdd9e8;border-radius:8px;width:100%;min-width:0;background:white;color:#233c5c}',
  '.exp-fields textarea{resize:vertical}.exp-form-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.exp-feedback{font-size:12px;color:#506c8d;margin-top:10px;min-height:20px}',
  '.exp-journal{grid-column:1/-1}.exp-journal-head,.exp-chart-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}',
  '.exp-journal-head .ops-intro,.exp-chart-head .ops-intro{margin:0 0 8px}.exp-filters{display:grid;grid-template-columns:minmax(140px,2fr) repeat(3,minmax(100px,1fr));gap:9px;margin:12px 0 16px}',
  '.exp-count{font-size:12px;color:#56718d}.exp-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.exp-summary span{border:1px solid #dce5ef;background:#f3f7fc;padding:9px 12px;border-radius:9px;font-size:12px}',
  '.exp-line{display:flex;justify-content:space-between;align-items:start;gap:12px;padding:13px 0;border-top:1px solid #e3eaf3}',
  '.exp-line h3{font-size:14px;margin:0 0 4px;color:#263d5d;overflow-wrap:anywhere}.exp-line small{font-size:11px;color:#70829a;line-height:1.5;display:block}',
  '.exp-line p{font-size:12px;color:#526982;margin:7px 0 0;overflow-wrap:anywhere}.exp-line-right{text-align:right;min-width:115px}',
  '.exp-amount{font-size:15px;font-weight:750;white-space:nowrap;color:#273d5b}.exp-row-actions{display:flex;gap:5px;justify-content:end;margin-top:9px}',
  '.exp-row-actions button{padding:5px 8px;font-size:11px;border:1px solid #cbd9e9;border-radius:7px;color:#31537d;background:white;cursor:pointer}',
  '.exp-empty{font-size:13px;color:#78889e;background:#f6f8fb;padding:18px;border-radius:10px;margin:10px 0}',
  '.exp-periods{display:flex;gap:5px;flex-wrap:wrap}.exp-periods button{border:1px solid #cad8eb;background:white;color:#34557b;border-radius:8px;font-size:12px;padding:7px 10px;cursor:pointer}',
  '.exp-periods button.active{background:#315ad0;color:white;border-color:#315ad0}',
  '.exp-chart-group{padding:9px 0 15px}.exp-chart-group+.exp-chart-group{border-top:1px solid #e2eaf4}',
  '.exp-chart-group-title{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:#6b7e96;margin-bottom:5px}',
  '.exp-chart-group-title strong{font-size:14px;color:#263e5d}.exp-bars-scroll{width:100%;overflow-x:auto;padding-bottom:6px}',
  '.exp-bars{display:flex;align-items:end;gap:7px;min-height:182px;min-width:320px;border-bottom:1px solid #dae3ed;padding:10px 3px 0}',
  '.exp-bar{display:flex;align-items:center;flex-direction:column;justify-content:end;gap:5px;flex:1;min-width:28px;max-width:74px;height:172px;text-align:center}',
  '.exp-bar-top{font-size:10px;color:#446080;white-space:nowrap}.exp-bar-fill{width:75%;max-width:46px;min-height:3px;border-radius:7px 7px 0 0;background:linear-gradient(180deg,#6989ee,#315bd0)}',
  '.exp-bar-date{font-size:10px;color:#657d96;white-space:nowrap}.exp-chart-help{font-size:11px;color:#7187a0;margin:8px 0 0}',
  '@media(max-width:1060px){.exp-layout{grid-template-columns:1fr}.exp-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  '@media(max-width:570px){.exp-fields{grid-template-columns:1fr}.exp-fields .exp-full{grid-column:auto}.exp-entry,.exp-journal,.exp-chart{padding:13px}.exp-filters{grid-template-columns:1fr 1fr}.exp-line{flex-wrap:wrap}.exp-line-right{width:100%;text-align:left}.exp-row-actions{justify-content:start}}'
 ].join('');document.head.append(style);
 let book=newExpenseBook(),editing=null,error='',period='month';
 try{
  const raw=localStorage.getItem(EXPENSES_STORAGE_KEY);
  if(raw)book=readExpenseBook(JSON.parse(raw));
 }catch(e){error='Не удалось открыть отдельный журнал расходов: '+e.message+'. Данные в браузере не изменялись. Для восстановления используйте сохранённый JSON-файл.'}
 const feedback=(message,isError=false)=>{const el=$('exFeedback');el.textContent=message;el.style.color=isError?'#ae3340':'#217052'};
 const blocked=()=>{if(!error)return false;feedback(error,true);return true};
 const write=next=>{
  const serialized=JSON.stringify(next);
  try{
   localStorage.setItem(EXPENSES_STORAGE_KEY,serialized);
   if(localStorage.getItem(EXPENSES_STORAGE_KEY)!==serialized)throw new Error('Браузер не подтвердил сохранение.');
   book=next;error='';window.dispatchEvent(new Event('landa:aux-data-changed'));return true;
  }catch(e){feedback('Запись не сохранена: '+e.message+'. Проверьте место в браузере и сохраните JSON-копию.',true);return false}
 };
 function formData(){
  const description=$('exDescription').value.trim();
  if(!description)throw new Error('Напишите, на что потрачены деньги.');
  const fields={date:$('exDate').value,amount:$('exAmount').value,description};
  // Preserve every hidden legacy field, including original currency, for edited old entries.
  if(editing){
   const previous=book.entries.find(e=>e.id===editing);
   if(!previous)throw new Error('Запись расхода не найдена.');
   return {...previous,...fields};
  }
  return {...fields,currency:'RUB',category:'Без категории',method:'other',payee:'',note:''};
 }
 function resetForm(){
  editing=null;$('exForm').reset();$('exDate').value=today();
  $('exAmountLabel').textContent='Сумма, ₽';
  $('exFormTitle').textContent='Новый расход';$('exSave').textContent='＋ Записать расход';$('exCancel').hidden=true;
 }
 const filters=()=>({
  search:$('exSearch').value,currency:$('exCurrencyFilter').value,
  dateFrom:$('exFrom').value,dateTo:$('exTo').value
 });
 function renderChart(items){
  const series=expenseSeries(items,period),blocks=[];
  for(const currency of EXPENSE_CURRENCIES){
   const all=series.filter(x=>x.currency===currency);
   if(!all.length)continue;
   const limit=period==='month'?12:14,last=all.slice(-limit);
   const peak=Math.max(...last.map(x=>x.amountCents),1);
   const values=last.map(x=>{
    const label=period==='month'?x.date.slice(5,7)+'.'+x.date.slice(0,4):
      x.date.slice(8,10)+'.'+x.date.slice(5,7);
    const height=Math.max(3,Math.round(x.amountCents/peak*112));
    const info=label+' · '+money(x.amountCents,currency)+' · записей: '+x.count;
    return '<div class="exp-bar" title="'+html(info)+'" role="img" aria-label="'+html(info)+'">'+
     '<span class="exp-bar-top">'+html(short(x.amountCents,currency))+'</span>'+
     '<div class="exp-bar-fill" style="height:'+height+'px"></div>'+
     '<span class="exp-bar-date">'+html(label)+'</span></div>';
   }).join('');
   const total=items.filter(x=>x.currency===currency).reduce((sum,e)=>sum+e.amountCents,0);
   blocks.push('<section class="exp-chart-group"><div class="exp-chart-group-title"><span>'+
    (period==='month'?'По месяцам':'По дням')+' · '+html(currency)+
    '</span><strong>'+html(money(total,currency))+'</strong></div><div class="exp-bars-scroll">'+
    '<div class="exp-bars">'+values+'</div></div><div class="exp-chart-help">Последние '+
    last.length+' периодов с расходами. Наведите на столбец, чтобы увидеть точную сумму.</div></section>');
  }
  $('exChart').innerHTML=blocks.join('')||'<p class="exp-empty">Добавьте первый расход, и здесь появится график.</p>';
 }
 function render(){
  if(error){
   $('exJournal').innerHTML='<div class="exp-empty" role="alert">'+html(error)+'</div>';
   $('exChart').innerHTML='<div class="exp-empty">График недоступен до восстановления журнала.</div>';
   return;
  }
  const items=expensesFiltered(book,filters()),totals=expenseTotals(items);
  $('exCount').textContent='Показано: '+items.length+' из '+book.entries.length;
  $('exSummary').innerHTML=Object.keys(totals).length?EXPENSE_CURRENCIES.filter(c=>totals[c]).map(c=>
   '<span>'+html(c)+': <b>'+html(money(totals[c],c))+'</b></span>').join(''):
   '<span>Нет расходов по выбранным фильтрам</span>';
  renderChart(items);
  $('exJournal').innerHTML=items.length?items.map(e=>{
   const legacy=[e.category!=='Без категории'?e.category:'',e.payee?'Кому: '+e.payee:'',
    e.method!=='other'?(methods[e.method]||e.method):''].filter(Boolean).join(' · ');
   const info=e.description||e.category||'Расход';
   return '<article class="exp-line"><div style="min-width:0;flex:1"><h3>'+html(info)+'</h3>'+
    '<small>'+html(e.date)+(legacy?' · '+html(legacy):'')+'</small>'+
    (e.note?'<p>Комментарий: '+html(e.note)+'</p>':'')+
    '</div><div class="exp-line-right"><div class="exp-amount">'+html(money(e.amountCents,e.currency))+'</div>'+
    '<div class="exp-row-actions"><button type="button" data-ex-edit="'+html(e.id)+'">Изменить</button>'+
    '<button type="button" data-ex-delete="'+html(e.id)+'">Удалить</button></div></div></article>';
  }).join(''):'<p class="exp-empty">Расходов пока нет. Заполните три поля и сохраните первую запись.</p>';
 }
 function download(data,filename,mime){
  const url=URL.createObjectURL(new Blob([data],{type:mime})),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
 }
 $('exForm').addEventListener('submit',e=>{
  e.preventDefault();if(blocked())return;
  try{
   const now=new Date().toISOString(),data=formData(),next=editing?
    editExpense(book,editing,data,now):addExpense(book,data,'expense-'+crypto.randomUUID(),now);
   if(!write(next))return;
   const isEdit=!!editing;resetForm();render();
   feedback(isEdit?'✓ Расход изменён.':'✓ Расход записан.');
  }catch(err){feedback(err.message,true)}
 });
 $('exCancel').addEventListener('click',()=>{resetForm();feedback('Редактирование отменено.')});
 $('exJournal').addEventListener('click',e=>{
  const editBtn=e.target.closest('[data-ex-edit]'),deleteBtn=e.target.closest('[data-ex-delete]');
  if(!editBtn&&!deleteBtn)return;if(blocked())return;
  const id=(editBtn||deleteBtn).dataset[editBtn?'exEdit':'exDelete'];
  const entry=book.entries.find(x=>x.id===id);if(!entry)return;
  if(deleteBtn){
   if(!confirm('Удалить расход на '+money(entry.amountCents,entry.currency)+'? Вернуть его можно только из JSON-копии.'))return;
   try{if(write(removeExpense(book,id))){if(editing===id)resetForm();render();feedback('✓ Расход удалён.')}}catch(err){feedback(err.message,true)}
   return;
  }
  editing=id;
  $('exDate').value=entry.date;$('exAmount').value=(entry.amountCents/100).toFixed(2);
  $('exDescription').value=entry.description||entry.category||'';
  $('exAmountLabel').textContent='Сумма, '+(currencies[entry.currency]||entry.currency);
  $('exFormTitle').textContent='Изменить расход';$('exSave').textContent='Сохранить изменения';$('exCancel').hidden=false;
  $('exForm').scrollIntoView({behavior:'smooth',block:'start'});
 });
 for(const id of ['exSearch','exCurrencyFilter','exFrom','exTo'])
  $(id).addEventListener(id==='exSearch'?'input':'change',render);
 document.querySelectorAll('[data-exp-period]').forEach(btn=>btn.addEventListener('click',()=>{
  period=btn.dataset.expPeriod;
  document.querySelectorAll('[data-exp-period]').forEach(b=>b.classList.toggle('active',b===btn));
  render();
 }));
 $('exExportCSV').addEventListener('click',()=>{
  if(blocked())return;
  const rows=expensesFiltered(book,filters());
  if(!rows.length){feedback('Нет расходов для экспорта по текущим фильтрам.',true);return}
  download(expenseCSV(rows),'LANDA-расходы-'+today()+'.csv','text/csv;charset=utf-8');
 });
 $('exExportJSON').addEventListener('click',()=>{
  if(blocked())return;
  download(JSON.stringify(book,null,2),'LANDA-расходы-копия-'+today()+'.json','application/json;charset=utf-8');
 });
 $('exImportJSON').addEventListener('click',()=>$('exImportFile').click());
 $('exImportFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{
   if(file.size>10000000)throw new Error('Файл больше 10 МБ.');
   const imported=readExpenseBook(JSON.parse(await file.text()));
   if(!confirm('Заменить текущий отдельный журнал ('+book.entries.length+' записей) журналом из файла ('+imported.entries.length+' записей)? Финансовые операции LANDA не затрагиваются.'))return;
   if(write(imported)){resetForm();render();feedback('✓ Отдельный журнал расходов загружен из JSON-файла.')}
  }catch(err){feedback('Импорт не выполнен: '+err.message,true)}
 });
 resetForm();render();if(error)feedback(error,true);
 window.LANDA_EXPENSES={render};
}
