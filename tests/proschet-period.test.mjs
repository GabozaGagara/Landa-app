import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCBValue,parseCBPaste,previewCBBaseline} from '../js/landa-cb-baseline.mjs';
const source=()=>readFileSync(new URL('../index.html',import.meta.url),'utf8');
const makeCB=({values={},control=0}={})=>{
 const cols=Array(290).fill('');
 cols[0]='29 октября 2026';cols[1]='Финансовый расчёт';cols[2]='CB29';
 for(const [row,val] of Object.entries(values))cols[Number(row)-1]=String(val);
 cols[287]=String(control);
 return cols.join('\n');
};
const rows=[
 {id:'b',name:'Второй',group:'cards',sourceRow:8,values:{OLD:100}},
 {id:'a',name:'Первый',group:'markets',sourceRow:5,values:{OLD:300}},
 {id:'c',name:'Контроль',group:'extras',sourceRow:9,values:{OLD:12}}
];
test('CB parser preserves row IDs, ignores headers and excludes control rows from sum',()=>{
 const column=makeCB({values:{5:'1 250,50',8:'−50',9:900},control:'1 200,50'});
 const parsed=parseCBPaste(column),before=JSON.stringify(rows);
 assert.equal(parsed.values[4],1250.5);assert.equal(parsed.values[7],-50);
 const result=previewCBBaseline(rows,column);
 assert.equal(result.match,true);assert.equal(result.calculated,1200.5);
 assert.equal(result.imported,3);assert.equal(result.values.b,-50);
 assert.equal(result.values.a,1250.5);assert.equal(result.values.c,900);
 assert.equal(JSON.stringify(rows),before);
});
test('malformed CB input and mismatched source/control are rejected',()=>{
 assert.throws(()=>parseCBPaste('1\n2\n3'),/288/);
 assert.throws(()=>parseCBPaste(makeCB({values:{5:'1.234,56'}})),/CB5/);
 assert.throws(()=>parseCBPaste(makeCB({control:''})),/CB288/);
 const result=previewCBBaseline(rows,makeCB({values:{5:99,8:12},control:100}));
 assert.equal(result.match,false);assert.equal(result.difference,11);
 assert.throws(()=>previewCBBaseline(rows,makeCB({values:{10:500},control:500})),/CB: 10/);
 assert.throws(()=>previewCBBaseline([],makeCB({values:{5:20},control:20})),/нет исходных строк/i);
 assert.throws(()=>previewCBBaseline([
  {id:'1',sourceRow:5,group:'markets'},{id:'2',sourceRow:5,group:'office'}
 ],makeCB({values:{5:20},control:20})),/повторяется/);
});
test('new calculation has empty amounts and manual income expense at end of untouched list',()=>{
 const html=source();
 assert.equal((html.match(/<\/html>/g)||[]).length,1);
 assert.match(html,/blankStart:true/);
 assert.match(html,/filter='all';searchText=''/);
 assert.doesNotMatch(html,/for\(let r of state\.rows\)\{if\(included\(r\)&&hasval\(r,snap\)\)/);
 assert.ok(html.indexOf('id="periodAdjustmentsPanel"')>html.indexOf('id="groups"'));
 assert.match(html,/id="calcIncome"/);assert.match(html,/id="calcExpense"/);
 assert.match(html,/state\.periodAdjustments/);
 assert.match(html,/function adjustedTotal\(id=snap\)/);
 assert.match(html,/total\(id\)\+a\.income-a\.expense/);
 assert.match(html,/let benchmark=state\.controlTotals\?\.\[snap\]/);
 assert.match(html,/id="cbImportText"/);assert.match(html,/id="cbImportApply" disabled/);
 assert.match(html,/state\.snapshots\.push\(ss\)/);
});
test('income and expense calculations are independent of cash and historic row values',()=>{
 const html=source();
 const extract=name=>{
  const idx=html.indexOf('function '+name+'('),start=html.indexOf('{',idx);
  let level=1,pos=start+1;
  for(;pos<html.length&&level;pos++){if(html[pos]==='{')level++;else if(html[pos]==='}')level--}
  return html.slice(idx,pos);
 };
 const fnSource=[extract('calcAdjustment'),extract('adjustedTotal'),extract('calcCompletion')].join('\n');
 const state={rows:[
  {id:'1',group:'markets',values:{old:100,new:40}},
  {id:'2',group:'office',values:{old:200,new:0}},
  {id:'3',group:'extras',values:{old:500,new:999}}
 ],periodAdjustments:{new:{income:30,expense:12}}};
 const orig=JSON.stringify(state);
 const helpers=[
  "const snap='new';",
  "const included=r=>r.group!=='extras';",
  "const hasval=(r,id)=>Object.prototype.hasOwnProperty.call(r.values,id);",
  "const nval=(r,id)=>r.values[id]||0;",
  "const total=id=>state.rows.reduce((s,r)=>s+(included(r)?nval(r,id):0),0);",
  fnSource,"return {adjustedTotal,calcCompletion};"
 ].join('\n');
 const actual=new Function('state',helpers)(state);
 assert.equal(actual.adjustedTotal('old'),300);
 assert.equal(actual.adjustedTotal('new'),58);
 assert.deepEqual(actual.calcCompletion('new'),{filled:2,total:2});
 assert.equal(JSON.stringify(state),orig);
});

test('CB1 must identify 29 October, not the previous 26 October period',()=>{
 const correct=makeCB({values:{5:50,8:20},control:70});
 assert.equal(parseCBPaste(correct).control,70);
 assert.throws(()=>parseCBPaste(correct.replace('29 октября 2026','26.10.2026')),/CB1 дата/);
 assert.throws(()=>parseCBPaste(correct.replace('29 октября 2026','')),/CB1 пуста/);
 assert.throws(()=>parseCBPaste(correct.replace('29 октября 2026','46321')),/CB1 дата/);
 assert.equal(parseCBPaste(correct.replace('29 октября 2026','46324')).control,70);
});
test('source income expense rows 289 and 290 are read but not added to source row totals',()=>{
 const full=makeCB({values:{5:25,8:35,9:999,289:50,290:15},control:60});
 const parsed=parseCBPaste(full);
 assert.equal(parsed.sourceExpense,50);
 assert.equal(parsed.sourceIncome,15);
 assert.equal(previewCBBaseline(rows,full).calculated,60);
 assert.equal(previewCBBaseline(rows,full).match,true);
});
test('29 October baseline UI supports safe existing-period replacement and JSON backup',()=>{
 const html=source();
 assert.match(html,/const existing=state\.snapshots\.find\(s=>s\.date==='2026-10-29'\)/);
 assert.match(html,/downloadBackup\(\)/);
 assert.match(html,/existing\?\.id/);
 assert.match(html,/delete row\.values\[id\]/);
 assert.match(html,/CB288/);
 assert.doesNotMatch(html,/CB289 — контрольный итог/);
});
