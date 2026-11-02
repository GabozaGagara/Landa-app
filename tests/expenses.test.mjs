import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 EXPENSES_STORAGE_KEY,newExpenseBook,expenseDate,expenseCents,normalizeExpense,readExpenseBook,
 addExpense,editExpense,removeExpense,expensesFiltered,expenseTotals,expenseSeries,expenseCSV
} from '../js/landa-expenses-core.mjs';

const fixture={date:'2026-11-02',amount:'1250,50',currency:'RUB',category:'Аренда',
 description:'Аренда офиса',payee:'Компания',method:'transfer',note:'Ноябрь'};
const now='2026-11-02T11:00:00.000Z';
test('separate journal creates item using integer cents and preserves the source input',()=>{
 const input=structuredClone(fixture),book=newExpenseBook(),after=addExpense(book,input,'e1',now);
 assert.equal(after.entries.length,1);
 assert.deepEqual(book,{version:1,entries:[]});
 assert.deepEqual(input,fixture);
 assert.equal(after.entries[0].amountCents,125050);
 assert.equal(after.entries[0].currency,'RUB');
 assert.equal(after.entries[0].createdAt,now);
 assert.equal(after.entries[0].updatedAt,now);
 assert.equal(JSON.stringify(readExpenseBook(JSON.parse(JSON.stringify(after)))),JSON.stringify(after));
});
test('change and remove expenses leave unrelated records untouched',()=>{
 const first=addExpense(newExpenseBook(),fixture,'e1',now);
 const second=addExpense(first,{...fixture,amount:'10.00',currency:'USD',category:'Транспорт'},'e2',now);
 const modified=editExpense(second,'e1',{...fixture,amount:'2500.75',description:'Другой офис'},'2026-11-03T13:00:00Z');
 assert.equal(modified.entries.length,2);
 assert.equal(modified.entries[0].amountCents,250075);
 assert.equal(modified.entries[0].createdAt,now);
 assert.deepEqual(second.entries[1],modified.entries[1]);
 assert.equal(second.entries[0].amountCents,125050);
 const deleted=removeExpense(modified,'e1');
 assert.equal(deleted.entries.length,1);
 assert.deepEqual(deleted.entries[0],modified.entries[1]);
 assert.throws(()=>removeExpense(deleted,'e1'));
 assert.throws(()=>editExpense(deleted,'e1',fixture,now));
});
test('sum by currency only, never mix rubles with dollars',()=>{
 let book=addExpense(newExpenseBook(),fixture,'e1',now);
 book=addExpense(book,{...fixture,amount:'10.00',currency:'USD',category:'Транспорт'},'e2',now);
 book=addExpense(book,{...fixture,amount:'4',currency:'RUB',category:'Офис'},'e3',now);
 const list=expensesFiltered(book);
 assert.deepEqual(expenseTotals(list),{RUB:125450,USD:1000});
 assert.equal(expensesFiltered(book,{currency:'USD'}).length,1);
 assert.equal(expensesFiltered(book,{category:'Аренда'}).length,1);
 assert.equal(expensesFiltered(book,{search:'офис'}).length,3);
 assert.equal(expensesFiltered(book,{dateFrom:'2026-11-03'}).length,0);
 assert.equal(expensesFiltered(book,{dateTo:'2026-11-01'}).length,0);
});
test('bad dates, invalid sums, currencies and corrupt journals are rejected',()=>{
 for(const date of ['2026-02-30','2026-13-01','2026-02-29','no-date'])
  assert.throws(()=>expenseDate(date));
 assert.equal(expenseDate('2028-02-29'),'2028-02-29');
 for(const value of ['0','-1','1.555','bad','NaN','Infinity','1000000001',''])
  assert.throws(()=>expenseCents(value));
 assert.equal(expenseCents('12,50'),1250);
 for(const changes of [{currency:'BTC'},{method:'unknown'},{category:'  '},{date:'2026-02-30'}])
  assert.throws(()=>addExpense(newExpenseBook(),{...fixture,...changes},'e3',now));
 const b=addExpense(newExpenseBook(),fixture,'e1',now);
 assert.throws(()=>readExpenseBook({...b,entries:[b.entries[0],b.entries[0]]}));
 assert.throws(()=>readExpenseBook({...b,entries:[{...b.entries[0],amountCents:0}]}));
 assert.throws(()=>readExpenseBook({...b,version:2}));
});
test('CSV export is safe from formulas and retains fields',()=>{
 const book=addExpense(newExpenseBook(),{...fixture,description:'=HYPERLINK("https://example.test")',note:'+2+3'},'e4',now);
 const csv=expenseCSV(book.entries);
 assert.ok(csv.startsWith('\ufeff'));
 assert.match(csv,/'=HYPERLINK/);
 assert.match(csv,/'\+2\+3/);
 assert.match(csv,/1250\.50/);
 assert.match(csv,/Аренда/);
});
test('expense page is separate from financial modules and old Prosсhet B is absent',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../js/landa-expenses-ui.mjs',import.meta.url),'utf8');
 assert.equal((html.match(/<\/html>/g)||[]).length,1);
 assert.match(html,/data-page="expenses"/);
 assert.match(html,/id="expensesPage"/);
 assert.match(html,/js\/landa-expenses-ui\.mjs/);
 assert.match(html,/if\(page!=='expenses'\)renderOps\(\)/);
 assert.doesNotMatch(html,/landa-proschet-b\.mjs|landa:proschet-render/);
 assert.match(ui,/landa-expenses-core.mjs/);
 assert.match(ui,/EXPENSES_STORAGE_KEY/);
 assert.match(ui,/exExportJSON/);
 assert.match(ui,/exImportJSON/);
 assert.doesNotMatch(ui,/\bops\s*=|\bsaveOps\s*\(|\bsave\s*\(|\bstate\s*=|GH_TOKEN|github|backup\.json/i);
 assert.equal(EXPENSES_STORAGE_KEY,'landa_expenses_standalone_v1');
});


test('expense chart groups costs by day and month without mixing currencies or editing source',()=>{
 let book=newExpenseBook();
 book=addExpense(book,{...fixture,date:'2026-10-30',amount:'1250,50'},'a',now);
 book=addExpense(book,{...fixture,date:'2026-10-30',amount:'49,50'},'b',now);
 book=addExpense(book,{...fixture,date:'2026-11-01',amount:'250'},'c',now);
 book=addExpense(book,{...fixture,date:'2026-11-01',currency:'USD',amount:'10'},'d',now);
 const before=JSON.stringify(book);
 const daily=expenseSeries(book.entries,'day');
 assert.deepEqual(daily,[
  {currency:'RUB',date:'2026-10-30',amountCents:130000,count:2},
  {currency:'RUB',date:'2026-11-01',amountCents:25000,count:1},
  {currency:'USD',date:'2026-11-01',amountCents:1000,count:1}
 ]);
 const monthly=expenseSeries(book.entries,'month');
 assert.deepEqual(monthly,[
  {currency:'RUB',date:'2026-10',amountCents:130000,count:2},
  {currency:'RUB',date:'2026-11',amountCents:25000,count:1},
  {currency:'USD',date:'2026-11',amountCents:1000,count:1}
 ]);
 assert.deepEqual(expenseSeries([],'day'),[]);
 assert.throws(()=>expenseSeries(book.entries,'invalid'));
 assert.equal(JSON.stringify(book),before);
});

test('simple date, amount, description create a RUB expense while legacy fields remain when edited',()=>{
 const fresh=addExpense(newExpenseBook(),{
  date:'2026-11-02',amount:'1500,25',description:'Заправка автомобиля',
  category:'Без категории',currency:'RUB',method:'other',payee:'',note:''
 },'simple',now);
 assert.equal(fresh.entries[0].amountCents,150025);
 assert.equal(fresh.entries[0].description,'Заправка автомобиля');
 assert.equal(fresh.entries[0].currency,'RUB');
 const legacy=addExpense(newExpenseBook(),fixture,'old',now);
 const original=legacy.entries[0];
 const changed=editExpense(legacy,'old',{
  ...original,date:'2026-11-03',amount:'1000,00',description:'Аренда помещения'
 },'2026-11-03T12:00:00Z').entries[0];
 assert.equal(changed.currency,'RUB');
 assert.equal(changed.category,'Аренда');
 assert.equal(changed.method,'transfer');
 assert.equal(changed.payee,'Компания');
 assert.equal(changed.note,'Ноябрь');
 assert.equal(original.amountCents,125050);
 assert.equal(changed.amountCents,100000);
});

test('expense form has precisely three input fields and both graph grouping choices',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const from=html.indexOf('<form id="exForm"'),to=html.indexOf('</form>',from);
 assert.ok(from>=0&&to>from);
 const form=html.slice(from,to);
 const ids=[...form.matchAll(/<(?:input|textarea|select)\b[^>]*id="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(ids,['exDate','exAmount','exDescription']);
 assert.match(html,/id="exChart"/);
 assert.match(html,/data-exp-period="day"/);
 assert.match(html,/data-exp-period="month"/);
 const ui=readFileSync(new URL('../js/landa-expenses-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/expenseSeries\(items,period\)/);
 assert.match(ui,/currency:'RUB',category:'Без категории',method:'other'/);
 assert.match(ui,/\{\.\.\.previous,\.\.\.fields\}/);
 assert.doesNotMatch(ui,/\bsaveOps\s*\(|\bstate\s*=/);
});
