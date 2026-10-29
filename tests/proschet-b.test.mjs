import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {totalsAt,groupView,biggestChanges,previousForView,duplicateSuggestions,checkBaseline,rowArchiveVisible} from '../js/landa-proschet-b-core.mjs';

// Completely synthetic finance data. Never use the owner's private production backup in CI.
const fixture=()=>({
 version:1,groups:[
  {id:'markets',label:'Маркетплейсы',included:true},
  {id:'cards',label:'Остатки на картах',included:true},
  {id:'extras',label:'Контроль и другие записи',included:false}],
 snapshots:[{id:'late',date:'2026-10-30',label:'Поздний расчёт'},
  {id:'early',date:'2026-10-01',label:'Ранний расчёт'}],
 rows:[
  {id:'1',name:'Карта А',group:'cards',subgroup:'Кошельки',sourceRow:5,
   values:{early:500,late:600},notes:{early:'Сверено'}},
  {id:'2',name:'Карта-Б',group:'cards',subgroup:'Кошельки',sourceRow:6,
   values:{early:-100,late:-180}},
  {id:'3',name:'Авито',group:'markets',subgroup:'К получению',
   values:{early:100,late:100}},
  {id:'4',name:'Контроль',group:'extras',subgroup:'Контроль',
   values:{early:9999,late:8888}},
  {id:'5',name:'карта б',group:'cards',subgroup:'Другие',values:{late:0}}
 ]});
test('stage 0 locks historical totals and excludes control rows without changing source',()=>{
 const data=fixture(),before=JSON.stringify(data);
 assert.deepEqual(totalsAt(data,'early'),{total:500,positive:600,negative:-100,groups:{cards:400,markets:100,extras:9999}});
 assert.deepEqual(totalsAt(data,'late'),{total:520,positive:700,negative:-180,groups:{cards:420,markets:100,extras:8888}});
 assert.equal(JSON.stringify(data),before);
});
test('stage 0 protects every old row and every historical field',()=>{
 const data=fixture(),copy=JSON.parse(JSON.stringify(data));
 assert.equal(checkBaseline(data,copy).ok,true);
 copy.rows[0].values.early=501;
 assert.equal(checkBaseline(data,copy).ok,false);
 copy.rows[0].values.early=500;
 copy.rows[0].notes.early='Потеряно';
 assert.equal(checkBaseline(data,copy).ok,false);
 copy.rows[0].notes.early='Сверено';
 copy.groups[0].label='Другая группа';
 assert.equal(checkBaseline(data,copy).ok,false);
 copy.groups[0].label='Маркетплейсы';
 copy.controlTotals={late:123};
 assert.equal(checkBaseline(data,copy).ok,false);
 delete copy.controlTotals;
 copy.rows.reverse();
 assert.equal(checkBaseline(data,copy).ok,false);
});
test('visual subgroup collapsing never changes money totals or mixes controls',()=>{
 const data=fixture(),original=JSON.stringify(data),view=groupView(data,'late');
 assert.equal(view.find(g=>g.id==='cards').total,420);
 assert.equal(view.find(g=>g.id==='extras').total,8888);
 assert.equal(view.find(g=>g.id==='cards').subgroups[0].rows.length,2);
 assert.equal(totalsAt(data,'late').total,520);
 assert.equal(JSON.stringify(data),original);
});
test('biggest changes respect calendar order, signs and exclude controls from total delta',()=>{
 const data=fixture(),result=biggestChanges(data,'late');
 assert.equal(previousForView(data,'late'),'early');
 assert.equal(result.items[0].name,'Контроль');
 assert.equal(result.totalDelta,20);
 assert.equal(result.allDelta,20);
 assert.equal(result.items.find(r=>r.id==='2').delta,-80);
 assert.equal(previousForView(data,'early'),null);
});
test('archive only changes visibility from chosen snapshot, never underlying money',()=>{
 const data=fixture(),before=JSON.stringify(data),prefs={archive:{'1':'late'}};
 assert.equal(rowArchiveVisible(prefs,'1',data.snapshots,'early'),true);
 assert.equal(rowArchiveVisible(prefs,'1',data.snapshots,'late'),false);
 assert.equal(totalsAt(data,'late').total,520);
 assert.equal(JSON.stringify(data),before);
});
test('duplicate detection suggests same-group normalized names without merging records',()=>{
 const data=fixture(),before=JSON.stringify(data),duplicates=duplicateSuggestions(data.rows);
 assert.equal(duplicates.length,1);
 assert.deepEqual(duplicates[0].items.map(x=>x.id),['2','5']);
 assert.equal(JSON.stringify(data),before);
});
test('new Prosсhet B interface must be additive, reversible and separated from financial storage',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.equal((html.match(/<\/html>/g)||[]).length,1);
 assert.match(html,/js\/landa-proschet-b\.mjs/);
 const module=readFileSync(new URL('../js/landa-proschet-b.mjs',import.meta.url),'utf8');
 assert.match(module,/landa_proschet_b_prefs_v1/);
 assert.doesNotMatch(module,/saveOps\s*\(|\bsave\s*\(|\bops\s*=/);
 assert.match(module,/Классический/);
 assert.match(module,/Быстрая проверка/);
 assert.match(module,/Возможные дубли/);
});
