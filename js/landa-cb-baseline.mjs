// Strict, read-only preview of Google Sheets CB1:CB289, for 2026-10-29.
export const CB_BASELINE_DATE='2026-10-29';
export const CB_CONTROL_ROW=288;
export const CB_FIRST_ENTRY_ROW=5;
export const CB_LAST_ENTRY_ROW=287;
const asCents=n=>Math.round(n*100);
export function parseCBValue(value,rowNumber){
 const v=String(value??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(/[₽р]/gi,'').replace(/\u2212/g,'-');
 if(!v)return null;
 if(!/^-?(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(v))throw Error('Не удалось прочитать число в CB'+rowNumber+': '+String(value).slice(0,60));
 const amount=Number(v.replace(',','.'));
 if(!Number.isFinite(amount)||!Number.isSafeInteger(Math.round(amount*100)))throw Error('Слишком большая сумма в CB'+rowNumber);
 return Math.round(amount*100)/100;
}
export function parseCBDate(input){
 const s=String(input??'').trim().replace(/\s+/g,' ').toLowerCase();
 if(!s)throw Error('CB1 пуста. Проверьте, что столбец относится к 29.10.2026.');
 let iso='';
 const m=s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/);
 if(m){const y=m[3]?(m[3].length===2?'20'+m[3]:m[3]):'2026';iso=y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')}
 else if(/^\d{4}-\d{2}-\d{2}$/.test(s))iso=s;
 else if(/^\d{4,5}$/.test(s))iso=new Date((Number(s)-25569)*86400000).toISOString().slice(0,10);
 else if(/\b29\s+(?:октября|october|oct)\s+2026\b/.test(s))iso='2026-10-29';
 if(iso!==CB_BASELINE_DATE)throw Error('В CB1 дата «'+String(input).slice(0,40)+'», ожидается 29.10.2026. Не загружайте другой период.');
 return iso;
}
export function parseCBPaste(text){
 if(typeof text!=='string'||text.length>100000)throw Error('Некорректный объём вставленных данных.');
 const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
 if(text.endsWith('\n'))lines.pop();
 if(lines.length<CB_CONTROL_ROW||lines.length>290)throw Error('Скопируйте один столбец CB1:CB288 (можно до CB290). Получено строк: '+lines.length+'.');
 if(lines.some(x=>x.includes('\t')))throw Error('Выделите только столбец CB без соседних столбцов.');
 parseCBDate(lines[0]);
 const values=lines.slice(CB_FIRST_ENTRY_ROW-1,CB_LAST_ENTRY_ROW).map((v,i)=>parseCBValue(v,i+CB_FIRST_ENTRY_ROW));
 const control=parseCBValue(lines[CB_CONTROL_ROW-1],CB_CONTROL_ROW);
 if(control===null)throw Error('В CB288 отсутствует контроль «Итог просчета». Возможно, дата ещё не заполнена.');
 return {date:CB_BASELINE_DATE,values,control,
  sourceExpense:lines.length>=289?parseCBValue(lines[288],289):null,
  sourceIncome:lines.length>=290?parseCBValue(lines[289],290):null};
}
export function previewCBBaseline(rows,text){
 if(!Array.isArray(rows)||!rows.length)throw Error('В LANDA нет исходных строк. Нужен полный исходный лист.');
 const parsed=parseCBPaste(text),mapping=new Map();
 for(const row of rows){
  if(row.sourceRow==null)continue;
  const number=Number(row.sourceRow);
  if(!Number.isSafeInteger(number)||number<CB_FIRST_ENTRY_ROW||number>CB_LAST_ENTRY_ROW)continue;
  if(mapping.has(number))throw Error('В LANDA повторяется исходная строка '+number+'. Импорт остановлен.');
  mapping.set(number,row);
 }
 if(!mapping.size)throw Error('В LANDA нет связей с номерами строк Excel.');
 const values={},unmapped=[];
 let sumCents=0,imported=0,blank=0;
 for(let index=0;index<parsed.values.length;index++){
  const row=index+CB_FIRST_ENTRY_ROW,value=parsed.values[index],item=mapping.get(row);
  if(!item){if(value!==null)unmapped.push(row);continue}
  if(value===null){blank++;continue}
  imported++;values[item.id]=value;
  if(item.group!=='extras')sumCents+=asCents(value);
 }
 if(unmapped.length)throw Error('Нет соответствующих исходных позиций для заполненных строк CB: '+unmapped.slice(0,15).join(', ')+(unmapped.length>15?' …':'')+'.');
 if(!imported)throw Error('В CB5:CB287 нет значений. Не загружайте пустой расчёт.');
 const calculated=sumCents/100;
 return {date:CB_BASELINE_DATE,values,imported,blank,control:parsed.control,calculated,
  difference:(sumCents-asCents(parsed.control))/100,match:sumCents===asCents(parsed.control),
  mapped:mapping.size,originalCount:rows.length};
}
