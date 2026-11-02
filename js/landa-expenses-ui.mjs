// Standalone LANDA expense journal. Never writes to financial operations or proschet.
import {
 EXPENSES_STORAGE_KEY,EXPENSE_CURRENCIES,newExpenseBook,readExpenseBook,
 addExpense,editExpense,removeExpense,expensesFiltered,expenseTotals,expenseCSV
} from './landa-expenses-core.mjs';

if(typeof document!=='undefined'&&document.getElementById('expensesPage')){
 const $=id=>document.getElementById(id);
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const methods={cash:'Наличные',card:'Карта',transfer:'Перевод',other:'Другое'};
 const money=(cents,currency)=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+currency;
 const today=()=>{const d=new Date(),p=x=>String(x).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())};
 const style=document.createElement('style');style.textContent=[
  '.exp-layout{display:grid;grid-template-columns:minmax(275px,380px) minmax(0,1fr);gap:15px;align-items:start;margin:15px 0 30px}',
  '.exp-entry,.exp-journal{padding:19px}.exp-entry h2,.exp-journal h2{font-size:17px;margin:0 0 14px;color:#223e61}',
  '.exp-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
  '.exp-fields label,.exp-filters label{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:12px;color:#475c78;font-weight:650}',
  '.exp-fields .exp-full{grid-column:1/-1}.exp-fields input,.exp-fields select,.exp-fields textarea,.exp-filters input,.exp-filters select{font:inherit;font-size:13px;padding:10px;border:1px solid #cdd9e8;border-radius:8px;width:100%;min-width:0;background:white;color:#233c5c}',
  '.exp-fields textarea{resize:vertical}.exp-form-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.exp-feedback{font-size:12px;color:#506c8d;margin-top:10px;min-height:20px}',
  '.exp-journal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.exp-journal-head .ops-intro{margin:0 0 8px}',
  '.exp-filters{display:grid;grid-template-columns:minmax(110px,2fr) repeat(4,minmax(90px,1fr));gap:9px;margin:12px 0 16px}',
  '.exp-count{font-size:12px;color:#56718d}.exp-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.exp-summary span{border:1px solid #dce5ef;background:#f3f7fc;padding:9px 12px;border-radius:9px;font-size:12px}',
  '.exp-line{display:flex;justify-content:space-between;align-items:start;gap:12px;padding:13px 0;border-top:1px solid #e3eaf3}',
  '.exp-line h3{font-size:14px;margin:0 0 4px;color:#263d5d}.exp-line small{font-size:11px;color:#70829a;line-height:1.5;display:block}',
  '.exp-line p{font-size:12px;color:#526982;margin:7px 0 0;overflow-wrap:anywhere}.exp-line-right{text-align:right;min-width:115px}',
  '.exp-amount{font-size:15px;font-weight:750;white-space:nowrap;color:#273d5b}.exp-row-actions{display:flex;gap:5px;justify-content:end;margin-top:9px}',
  '.exp-row-actions button{padding:5px 8px;font-size:11px;border:1px solid #cbd9e9;border-radius:7px;color:#31537d;background:white;cursor:pointer}',
  '.exp-empty{font-size:13px;color:#78889e;background:#f6f8fb;padding:18px;border-radius:10px;margin:10px 0}',
  '@media(max-width:1050px){.exp-layout{grid-template-columns:1fr}.exp-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  '@media(max-width:570px){.exp-fields{grid-template-columns:1fr}.exp-fields .exp-full{grid-column:auto}.exp-entry,.exp-journal{padding:13px}.exp-filters{grid-template-columns:1fr 1fr}.exp-line{flex-wrap:wrap}.exp-line-right{width:100%;text-align:left}.exp-row-actions{justify-content:start}}'
 ].join('');document.head.append(style);
 let book=newExpenseBook(),editing=null,error='';
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
   book=next;error='';return true;
  }catch(e){feedback('Запись не сохранена: '+e.message+'. Проверьте место в браузере и сохраните JSON-копию.',true);return false}
 };
 const formData=()=>({
  date:$('exDate').value,amount:$('exAmount').value,currency:$('exCurrency').value,
  category:$('exCategory').value,method:$('exMethod').value,payee:$('exPayee').value,
  description:$('exDescription').value,note:$('exNote').value
 });
 function resetForm(){
  editing=null;$('exForm').reset();$('exDate').value=today();
  $('exFormTitle').textContent='Новый расход';$('exSave').textContent='＋ Записать расход';$('exCancel').hidden=true;
 }
 function refreshCategories(){
  const select=$('exCategoryFilter'),keep=select.value;
  const values=[...new Set(book.entries.map(r=>r.category))].sort((a,b)=>a.localeCompare(b,'ru'));
  select.innerHTML='<option value="all">Все категории</option>'+values.map(k=>'<option value="'+html(k)+'">'+html(k)+'</option>').join('');
  select.value=keep==='all'||values.includes(keep)?keep:'all';
 }
 const filters=()=>({
  search:$('exSearch').value,category:$('exCategoryFilter').value,currency:$('exCurrencyFilter').value,
  dateFrom:$('exFrom').value,dateTo:$('exTo').value
 });
 function render(){
  refreshCategories();
  if(error){$('exJournal').innerHTML='<div class="exp-empty" role="alert">'+html(error)+'</div>';return}
  const items=expensesFiltered(book,filters()),totals=expenseTotals(items);
  $('exCount').textContent='Показано: '+items.length+' из '+book.entries.length;
  $('exSummary').innerHTML=Object.keys(totals).length?EXPENSE_CURRENCIES.filter(c=>totals[c]).map(c=>
   '<span>'+html(c)+': <b>'+html(money(totals[c],c))+'</b></span>').join(''):
   '<span>Нет расходов по выбранным фильтрам</span>';
  $('exJournal').innerHTML=items.length?items.map(e=>'<article class="exp-line"><div style="min-width:0;flex:1">'+
   '<h3>'+html(e.category)+'</h3><small>'+html(e.date)+' · '+html(methods[e.method]||e.method)+
   (e.payee?' · Кому: '+html(e.payee):'')+'</small>'+
   (e.description?'<p>'+html(e.description)+'</p>':'')+
   (e.note?'<p>Комментарий: '+html(e.note)+'</p>':'')+
   '</div><div class="exp-line-right"><div class="exp-amount">'+html(money(e.amountCents,e.currency))+'</div>'+
   '<div class="exp-row-actions"><button type="button" data-ex-edit="'+html(e.id)+'">Изменить</button>'+
   '<button type="button" data-ex-delete="'+html(e.id)+'">Удалить</button></div></div></article>').join(''):
   '<p class="exp-empty">Расходов пока нет. Заполните форму слева (или выше на телефоне).</p>';
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
    editExpense(book,editing,data,now):
    addExpense(book,data,'expense-'+crypto.randomUUID(),now);
   if(!write(next))return;
   const isEdit=!!editing;resetForm();render();
   feedback(isEdit?'✓ Расход изменён в отдельном журнале.':'✓ Расход записан в отдельный журнал.');
  }catch(e){feedback(e.message,true)}
 });
 $('exCancel').addEventListener('click',()=>{resetForm();feedback('Редактирование отменено.')});
 $('exJournal').addEventListener('click',e=>{
  const editBtn=e.target.closest('[data-ex-edit]'),deleteBtn=e.target.closest('[data-ex-delete]');
  if(!editBtn&&!deleteBtn)return;if(blocked())return;
  const id=(editBtn||deleteBtn).dataset[editBtn?'exEdit':'exDelete'];
  const entry=book.entries.find(x=>x.id===id);if(!entry)return;
  if(deleteBtn){
   if(!confirm('Удалить расход «'+entry.category+'» на '+money(entry.amountCents,entry.currency)+'? Отменить удаление можно только через JSON-копию.'))return;
   try{if(write(removeExpense(book,id))){if(editing===id)resetForm();render();feedback('✓ Расход удалён.')}}catch(err){feedback(err.message,true)}
   return;
  }
  editing=id;
  $('exDate').value=entry.date;$('exAmount').value=(entry.amountCents/100).toFixed(2);
  $('exCurrency').value=entry.currency;$('exCategory').value=entry.category;
  $('exMethod').value=entry.method;$('exPayee').value=entry.payee;$('exDescription').value=entry.description;
  $('exNote').value=entry.note;
  $('exFormTitle').textContent='Изменить расход';$('exSave').textContent='Сохранить изменения';$('exCancel').hidden=false;
  $('exForm').scrollIntoView({behavior:'smooth',block:'start'});
 });
 for(const id of ['exSearch','exCategoryFilter','exCurrencyFilter','exFrom','exTo']){
  $(id).addEventListener(id==='exSearch'?'input':'change',render);
 }
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
