/* LANDA proschet B: pure view models. Never mutates source rows, values, periods or totals. */
export const cents=n=>Math.round(Number(n||0)*100);
export const fromCents=n=>Math.round(n)/100;
export const included=row=>row.group!=='extras';
export const valueAt=(row,id)=>typeof row?.values?.[id]==='number'&&Number.isFinite(row.values[id])?row.values[id]:0;
export function totalsAt(data,id){
 const groups={};let total=0,positive=0,negative=0;
 for(const row of data.rows||[]){
  const n=cents(valueAt(row,id));groups[row.group]=(groups[row.group]||0)+n;
  if(included(row)){total+=n;if(n>0)positive+=n;else negative+=n;}
 }
 return {total:fromCents(total),positive:fromCents(positive),negative:fromCents(negative),
  groups:Object.fromEntries(Object.entries(groups).map(([k,n])=>[k,fromCents(n)]))};
}
export function chronologicalPrevious(data,currentId){
 const items=(data.snapshots||[]).map((s,i)=>({...s,ordinal:i}))
  .sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31')||a.ordinal-b.ordinal);
 const index=items.findIndex(x=>x.id===currentId);
 return index>0?items[index-1].id:null;
}
export function previousForView(data,id){
 const cur=(data.snapshots||[]).find(s=>s.id===id);
 if(!cur)return null;
 // Older undated snapshots retain their original order; dated snapshots compare by date.
 if(!cur.date){const i=data.snapshots.findIndex(s=>s.id===id);return i>0?data.snapshots[i-1].id:null}
 const items=data.snapshots.map((s,i)=>({...s,ordinal:i})).filter(s=>s.date)
  .sort((a,b)=>a.date.localeCompare(b.date)||a.ordinal-b.ordinal);
 const index=items.findIndex(s=>s.id===id);
 return index>0?items[index-1].id:null;
}
export function groupView(data,id){
 return (data.groups||[]).map(group=>{
  const map=new Map();
  for(const row of data.rows||[])if(row.group===group.id){
   const k=String(row.subgroup||'Разное');
   if(!map.has(k))map.set(k,{key:k,totalCents:0,rows:[]});
   const sub=map.get(k);
   sub.totalCents+=cents(valueAt(row,id));sub.rows.push(row);
  }
  const subgroups=[...map.values()].map(g=>({name:g.key,total:fromCents(g.totalCents),rows:g.rows}));
  return {id:group.id,name:group.label,included:included({group:group.id}),
   total:fromCents(subgroups.reduce((s,g)=>s+cents(g.total),0)),subgroups,
   count:subgroups.reduce((s,g)=>s+g.rows.length,0)};
 });
}
export function biggestChanges(data,id,limit=10){
 const prev=previousForView(data,id);
 if(!prev)return {previous:null,items:[],totalDelta:null,allDelta:0};
 const items=(data.rows||[]).map(r=>{
  const delta=cents(valueAt(r,id))-cents(valueAt(r,prev));
  return {id:r.id,name:r.name,group:r.group,subgroup:r.subgroup,delta:fromCents(delta),
   previous:valueAt(r,prev),current:valueAt(r,id),included:included(r)};
 }).filter(x=>x.delta!==0).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||String(a.name).localeCompare(String(b.name),'ru'));
 const allDelta=items.filter(x=>x.included).reduce((s,x)=>s+cents(x.delta),0);
 return {previous:prev,items:items.slice(0,limit),allDelta:fromCents(allDelta),
   totalDelta:fromCents(cents(totalsAt(data,id).total)-cents(totalsAt(data,prev).total)),changedCount:items.length};
}
export const normalizedName=s=>String(s||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
 .replace(/[^a-zа-я0-9]+/gi,' ').trim().replace(/\s+/g,' ');
export function duplicateSuggestions(rows){
 const groups=new Map();
 for(const row of rows||[]){
  const normalized=normalizedName(row.name);
  if(!normalized||normalized.length<3)continue;
  const key=String(row.group)+'|'+normalized;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({id:row.id,name:row.name,subgroup:row.subgroup,group:row.group});
 }
 return [...groups.values()].filter(items=>items.length>1).map(items=>({name:items[0].name,items}))
  .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
export function checkBaseline(original,after){
 if(!original||!after||!Array.isArray(original.rows)||!Array.isArray(after.rows))return {ok:false,reason:'Данные отсутствуют'};
 if(JSON.stringify(original.groups)!==JSON.stringify(after.groups))
  return {ok:false,reason:'Изменены исходные финансовые группы'};
 if(JSON.stringify(original.controlTotals)!==JSON.stringify(after.controlTotals))
  return {ok:false,reason:'Изменены контрольные суммы'};
 if(original.version!==after.version)return {ok:false,reason:'Изменена версия просчёта'};
 const ids=o=>(o.rows||[]).map(r=>r.id);
 if(JSON.stringify(ids(original))!==JSON.stringify(ids(after)))return {ok:false,reason:'Изменён порядок или состав строк'};
 if(JSON.stringify(original.snapshots)!==JSON.stringify(after.snapshots))return {ok:false,reason:'Изменены исторические периоды'};
 const byId=new Map(after.rows.map(r=>[r.id,r]));
 for(const row of original.rows){
  const actual=byId.get(row.id);
  if(!actual||JSON.stringify(row)!==JSON.stringify(actual))return {ok:false,reason:'Строка изменена: '+row.id};
 }
 for(const snap of original.snapshots){
  if(JSON.stringify(totalsAt(original,snap.id))!==JSON.stringify(totalsAt(after,snap.id)))
   return {ok:false,reason:'Изменился итог за '+snap.id};
 }
 return {ok:true,rows:original.rows.length,periods:original.snapshots.length};
}
export function rowArchiveVisible(pref,rowId,snapshots,id){
 const marker=pref?.archive?.[rowId];
 if(!marker)return true;
 const archivedAt=snapshots.find(s=>s.id===marker);
 const viewing=snapshots.find(s=>s.id===id);
 if(!archivedAt||!viewing)return true;
 if(archivedAt.date&&viewing.date)return viewing.date<archivedAt.date;
 return snapshots.findIndex(s=>s.id===id)<snapshots.findIndex(s=>s.id===marker);
}
