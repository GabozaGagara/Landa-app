// LANDA standalone expense journal.
// Deliberately independent from proschet, operations, suppliers, invoices, cash and GitHub sync.
export const EXPENSES_STORAGE_KEY='landa_expenses_standalone_v1';
export const EXPENSES_VERSION=1;
export const EXPENSE_CURRENCIES=['RUB','USD','BYN','EUR'];
export const EXPENSE_PAYMENTS=['cash','card','transfer','other'];
export const newExpenseBook=()=>({version:EXPENSES_VERSION,entries:[]});
const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
export function expenseDate(value){
 const date=String(value??'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Укажите корректную дату расхода.');
 const [y,m,d]=date.split('-').map(Number);
 const real=new Date(Date.UTC(y,m-1,d));
 if(real.getUTCFullYear()!==y||real.getUTCMonth()!==m-1||real.getUTCDate()!==d||y<2000||y>2100)
  throw new Error('Дата расхода указана неверно.');
 return date;
}
export function expenseCents(raw){
 const v=String(raw??'').trim().replace(/\s/g,'').replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw new Error('Укажите сумму больше нуля, не более двух знаков после запятой.');
 const [whole,fraction='']=v.split('.');
 const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000000)
  throw new Error('Сумма расхода должна быть больше нуля и не превышать 1 млрд.');
 return amount;
}
function clean(value,max){return String(value??'').trim().slice(0,max)}
export function normalizeExpense(input,{id,createdAt,updatedAt}={}){
 if(!input||typeof input!=='object')throw new Error('Данные расхода не заполнены.');
 const date=expenseDate(input.date);
 const category=clean(input.category,90);
 if(!category)throw new Error('Укажите категорию расхода.');
 const currency=String(input.currency||'RUB').toUpperCase();
 if(!EXPENSE_CURRENCIES.includes(currency))throw new Error('Неизвестная валюта расхода.');
 const method=String(input.method||'other');
 if(!EXPENSE_PAYMENTS.includes(method))throw new Error('Укажите способ оплаты.');
 const amountCents=typeof input.amountCents==='number'&&Number.isSafeInteger(input.amountCents)
  &&!hasOwn(input,'amount')?expenseCents((input.amountCents/100).toFixed(2)):
  expenseCents(input.amount);
 if(typeof id!=='string'||!id||id.length>150)throw new Error('Недопустимый идентификатор расхода.');
 const stamp=String(updatedAt||createdAt||'');
 if(!/^\d{4}-\d\d-\d\dT/.test(stamp))throw new Error('Некорректное время записи.');
 return {
  id,date,amountCents,currency,category,
  description:clean(input.description,300),payee:clean(input.payee,180),
  method,note:clean(input.note,1200),createdAt:String(createdAt),updatedAt:String(updatedAt||createdAt)
 };
}
export function readExpenseBook(data){
 if(!data||data.version!==EXPENSES_VERSION||!Array.isArray(data.entries)||data.entries.length>20000)
  throw new Error('Неверный формат отдельного журнала расходов.');
 const ids=new Set(),entries=[];
 for(const item of data.entries){
  if(typeof item?.id!=='string'||ids.has(item.id))throw new Error('В журнале повторяются или отсутствуют ID расходов.');
  ids.add(item.id);
  const normalized=normalizeExpense(item,{id:item.id,createdAt:item.createdAt,updatedAt:item.updatedAt});
  // Reject malformed or altered monetary values rather than silently repairing historical rows.
  if(normalized.amountCents!==item.amountCents)throw new Error('Некорректная сумма в сохранённом журнале.');
  entries.push(normalized);
 }
 return {version:EXPENSES_VERSION,entries};
}
export function addExpense(book,data,id,at){
 const current=readExpenseBook(book);
 if(current.entries.some(x=>x.id===id))throw new Error('Расход с таким ID уже существует.');
 if(current.entries.length>=20000)throw new Error('Достигнут лимит количества расходов.');
 const entry=normalizeExpense(data,{id,createdAt:at,updatedAt:at});
 return {version:EXPENSES_VERSION,entries:[...current.entries,entry]};
}
export function editExpense(book,id,data,at){
 const current=readExpenseBook(book);
 const i=current.entries.findIndex(x=>x.id===id);
 if(i<0)throw new Error('Расход не найден.');
 const prior=current.entries[i];
 const edited=normalizeExpense(data,{id,createdAt:prior.createdAt,updatedAt:at});
 return {version:EXPENSES_VERSION,entries:current.entries.map((r,k)=>k===i?edited:r)};
}
export function removeExpense(book,id){
 const current=readExpenseBook(book);
 if(!current.entries.some(x=>x.id===id))throw new Error('Расход не найден.');
 return {version:EXPENSES_VERSION,entries:current.entries.filter(x=>x.id!==id)};
}
export function expensesFiltered(book,{search='',category='all',currency='all',dateFrom='',dateTo=''}={}){
 const value=String(search||'').trim().toLocaleLowerCase('ru-RU');
 return readExpenseBook(book).entries.filter(x=>
  (category==='all'||x.category===category)&&(currency==='all'||x.currency===currency)
  &&(!dateFrom||x.date>=dateFrom)&&(!dateTo||x.date<=dateTo)
  &&(!value||[x.category,x.description,x.payee,x.note,x.method].join(' ').toLocaleLowerCase('ru-RU').includes(value))
 ).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
}
export function expenseTotals(entries){
 const totals={};
 for(const e of entries||[]){
  if(!EXPENSE_CURRENCIES.includes(e.currency)||!Number.isSafeInteger(e.amountCents))
   throw new Error('Некорректная сумма в журнале.');
  totals[e.currency]=(totals[e.currency]||0)+e.amountCents;
 }
 return totals;
}
export function expenseCSVCell(value){
 const s=String(value??'');
 const protectedValue=/^\s*[=+\-@]/.test(s)?"'"+s:s;
 return '"'+protectedValue.replace(/"/g,'""')+'"';
}
export function expenseCSV(entries){
 const header=['Дата','Категория','Описание','Кому оплачено','Сумма','Валюта','Способ оплаты','Комментарий','Дата записи','ID'];
 const methods={cash:'Наличные',card:'Карта',transfer:'Перевод',other:'Другое'};
 const rows=(entries||[]).map(r=>[
  r.date,r.category,r.description,r.payee,(r.amountCents/100).toFixed(2),r.currency,
  methods[r.method]||r.method,r.note,r.createdAt,r.id
 ]);
 return '\ufeff'+[header,...rows].map(row=>row.map(expenseCSVCell).join(';')).join('\r\n');
}
