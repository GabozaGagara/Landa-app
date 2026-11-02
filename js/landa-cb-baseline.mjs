// Strict, read-only preview of Google Sheets CB1:CB289, for 2026-10-29.
export const CB_BASELINE_DATE='2026-10-29';
export const CB_VALUES_LENGTH=289;
const asCents=n=>Math.round(n*100);
export function parseCBValue(value,rowNumber){
 const v=String(value??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(/[₽р]/gi,'').replace(/\u2212/g,'-');
 if(!v)return null;
 if(!/^-?(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(v)){
  // Headings can appear in CB1:CB4; source financial entries start below the sheet header.
  if(rowNumber<=4)return null;
  throw Error('Не удалось прочитать число в CB'+rowNumber+': '+String(value).slice(0,60));
 }
 const amount=Number(v.replace(',','.'));
 if(!Number.isFinite(amount)||!Number.isSafeInteger(asCents(amount)))throw Error('Слишком большая сумма в CB'+rowNumber);
 return asCents(amount)/100;
}
export function parseCBPaste(text){
 if(typeof text!=='string'||text.length>80000)throw Error('Некорректный объём вставленных данных.');
 const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
 if(lines.length===290&&lines[289]==='')lines.pop();
 if(lines.length!==CB_VALUES_LENGTH)throw Error('Скопируйте ровно CB1:CB289. Найдено строк: '+lines.length+' вместо 289.');
 if(lines.some(line=>line.includes('\t')))throw Error('Выделите один столбец CB без соседних столбцов.');
 const values=lines.map((v,i)=>parseCBValue(v,i+1));
 if(values[288]===null)throw Error('В CB289 нет контрольного итога.');
 return {values:values.slice(0,288),control:values[288]};
}
export function previewCBBaseline(rows,text){
 if(!Array.isArray(rows)||rows.length===0)throw Error('В LANDA нет исходных строк. Нужен полный исходный лист с названиями, а не один столбец CB.');
 const parsed=parseCBPaste(text),mapping=new Map();
 for(const row of rows){
  const number=Number(row.sourceRow);
  if(!Number.isSafeInteger(number)||number<1||number>288)continue;
  if(mapping.has(number))throw Error('В LANDA повторяется исходная строка '+number+'. Импорт остановлен.');
  mapping.set(number,row);
 }
 if(!mapping.size)throw Error('Нет связей с номерами строк Excel. Сначала требуется загрузить структуру исходного листа.');
 const values={},unmapped=[];
 let sumCents=0,imported=0,blank=0;
 for(let row=1;row<=288;row++){
  const value=parsed.values[row-1],item=mapping.get(row);
  if(!item){
   if(row<=4)continue; // spreadsheet headers, not financial positions
   if(value!==null)unmapped.push(row);
   continue;
  }
  if(value===null){blank++;continue}
  imported++;values[item.id]=value;
  if(item.group!=='extras')sumCents+=asCents(value);
 }
 if(unmapped.length)throw Error('Нет соответствующих исходных позиций для заполненных строк CB: '+unmapped.slice(0,15).join(', ')+(unmapped.length>15?' …':'')+'. Нужна структура листа.');
 if(imported===0)throw Error('В CB1:CB288 нет распознанных сумм.');
 const calculated=sumCents/100,difference=(sumCents-asCents(parsed.control))/100;
 return {date:CB_BASELINE_DATE,values,imported,blank,control:parsed.control,calculated,
  difference:Math.round(difference*100)/100,
  match:sumCents===asCents(parsed.control),
  mapped:mapping.size,originalCount:rows.length};
}
