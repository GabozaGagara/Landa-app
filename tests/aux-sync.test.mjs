import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 AUX_KEYS,emptyAux,parseLocalAux,validateAux,mergeAux,auxToLocalWrites,auxEqual,applyAuxStorage
} from '../js/landa-aux-sync-core.mjs';

const store=(data={},failKey='')=>{
 const db=new Map(Object.entries(data));
 return {
  getItem:key=>db.has(key)?db.get(key):null,
  setItem:(key,value)=>{if(key===failKey)throw Error('storage disabled');db.set(key,value)},
  removeItem:key=>{db.delete(key)},
  content:db
 };
};
const expense=(id,amountCents=100)=>({
 id,date:'2026-11-03',amountCents,currency:'RUB',
 category:'Без категории',description:'Расход '+id,
 payee:'',method:'other',note:'',
 createdAt:'2026-11-03T12:00:00.000Z',updatedAt:'2026-11-03T12:00:00.000Z'
});
const place=(id)=>({id,createdAt:'2026-11-03T12:00:00.000Z',name:'Паллет',closed:false,invoices:[],entries:[]});
const data=(section,key,value)=>{
 const d=emptyAux();d.collections[section][key]=value;return d;
};
test('initial device merges remote expenses and receiving into empty local without touching finance',()=>{
 const remote=emptyAux();
 remote.collections.expenses.e1=expense('e1');
 remote.collections.receiving['["invoice",0]']={received:2,note:'OK'};
 const a=mergeAux(emptyAux(),emptyAux(),remote);
 assert.equal(a.conflicts.length,0);
 assert.equal(a.merged.collections.expenses.e1.amountCents,100);
 const local=store();
 const writes=auxToLocalWrites(a.merged,local);
 applyAuxStorage(local,writes);
 assert.equal(JSON.parse(local.getItem(AUX_KEYS.expenses)).entries.length,1);
 assert.equal(JSON.parse(local.getItem(AUX_KEYS.receiving)).entries['["invoice",0]'].received,2);
 assert.equal(local.getItem('landa_finance_operations_v1'),null);
 assert.equal(local.getItem('landa_proschet_offline_v1'),null);
 assert.equal(local.getItem('landa_github_token_v1'),null);
 assert.ok(auxEqual(parseLocalAux(local),remote));
});
test('two devices adding different expenses merge without conflicts or duplicates',()=>{
 const base=emptyAux(),a=data('expenses','a',expense('a',150)),b=data('expenses','b',expense('b',230));
 const outcome=mergeAux(base,a,b);
 assert.equal(outcome.conflicts.length,0);
 assert.deepEqual(new Set(Object.keys(outcome.merged.collections.expenses)),new Set(['a','b']));
 const again=mergeAux(outcome.merged,outcome.merged,outcome.merged);
 assert.ok(auxEqual(again.merged,outcome.merged));
});
test('editing same expense concurrently is reported as conflict, not silently overwritten',()=>{
 const base=data('expenses','a',expense('a',150));
 const local=data('expenses','a',expense('a',200));
 const remote=data('expenses','a',expense('a',300));
 const a=mergeAux(base,local,remote);
 assert.equal(a.merged,null);
 assert.equal(a.conflicts.length,1);
 assert.equal(a.conflicts[0].section,'expenses');
});
test('deleted expense is preserved as deletion unless another device modified it',()=>{
 const base=data('expenses','a',expense('a',150));
 const local=emptyAux(),untouched=validateAux(base);
 assert.equal(Object.keys(mergeAux(base,local,untouched).merged.collections.expenses).length,0);
 const modified=data('expenses','a',expense('a',250));
 assert.equal(mergeAux(base,local,modified).conflicts.length,1);
});
test('independent receiving counts, alias groups, MoySklad mappings and pallet sessions all merge',()=>{
 const local=emptyAux(),remote=emptyAux();
 local.collections.receiving.trackA={received:4,note:''};
 remote.collections.receiving.trackB={received:7,note:'ready'};
 local.collections.aliases.g1={id:'g1',name:'Puzzi',members:['[1]','[2]']};
 remote.collections.moysklad['["all","puzzi",""]']='ms-product-1';
 remote.collections.pallets.p1=place('p1');
 const result=mergeAux(emptyAux(),local,remote);
 assert.equal(result.conflicts.length,0);
 const writes=auxToLocalWrites(result.merged,store());
 const store2=store();applyAuxStorage(store2,writes);
 assert.equal(JSON.parse(store2.getItem(AUX_KEYS.receiving)).entries.trackB.received,7);
 assert.equal(JSON.parse(store2.getItem(AUX_KEYS.aliases)).groups[0].id,'g1');
 assert.equal(JSON.parse(store2.getItem(AUX_KEYS.pallets)).sessions[0].id,'p1');
 assert.equal(JSON.parse(store2.getItem(AUX_KEYS.moysklad))['["all","puzzi",""]'],'ms-product-1');
});
test('cross-device alias rules cannot silently assign the same product to two groups',()=>{
 const m=emptyAux();
 m.collections.aliases.g1={id:'g1',name:'One',members:['a','b']};
 m.collections.aliases.g2={id:'g2',name:'Two',members:['a','c']};
 assert.throws(()=>auxToLocalWrites(m,store()),/Конфликт правил/);
});
test('missing previous local journal cannot become a mass deletion',()=>{
 const base=data('expenses','a',expense('a'));
 const merged=emptyAux();
 assert.throws(()=>auxToLocalWrites(merged,store(),base),/Исчез локальный/);
});
test('storage partial write rolls back previously touched keys',()=>{
 const before={ [AUX_KEYS.expenses]:'old-expenses',[AUX_KEYS.receiving]:'old-counts'};
 const local=store(before,AUX_KEYS.receiving);
 assert.throws(()=>applyAuxStorage(local,{
  [AUX_KEYS.expenses]:'new-expenses',
  [AUX_KEYS.receiving]:'new-counts'
 }),/storage disabled/);
 assert.equal(local.getItem(AUX_KEYS.expenses),'old-expenses');
 assert.equal(local.getItem(AUX_KEYS.receiving),'old-counts');
});
test('corrupted auxiliary document is refused before local changes',()=>{
 assert.throws(()=>validateAux({app:'LANDA-suite',version:1,collections:{}}));
 const d=emptyAux();d.collections.expenses.e1={...expense('e1'),id:'other'};
 assert.throws(()=>validateAux(d),/ID записи/);
 const good=emptyAux();good.collections.moysklad.a='product1';
 assert.equal(validateAux(good).collections.moysklad.a,'product1');
});
test('UI dispatches sync after all five journals, finance sync remains authenticated',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const sync=readFileSync(new URL('../js/landa-aux-sync.mjs',import.meta.url),'utf8');
 const exp=readFileSync(new URL('../js/landa-expenses-ui.mjs',import.meta.url),'utf8');
 const receiving=readFileSync(new URL('../js/landa-receiving-ui.mjs',import.meta.url),'utf8');
 const moy=readFileSync(new URL('../js/landa-moysklad-ui.mjs',import.meta.url),'utf8');
 const pallet=readFileSync(new URL('../js/landa-pallet-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/landa-aux-sync\.mjs/);
 assert.match(html,/ghExtraStatus/);
 assert.match(html,/landa:github-config-saved/);
 for(const file of [exp,receiving,moy,pallet])assert.match(file,/landa:aux-data-changed/);
 assert.match(sync,/lando:aux-data-changed|landa:aux-data-changed/);
 assert.match(sync,/landa-data\/auxiliary-sync\.json/);
 assert.doesNotMatch(sync,/\/admin\/supplier|\/supplier-edit|\/submit/);
 assert.doesNotMatch(sync,/contents\/'+\s*['"]landa-data\/backup\.json/);
 assert.match(html,/landa-data\/backup\.json/);
});
