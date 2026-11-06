// Pure, per-record three-way merge for LANDA browser-only journals.
// No credentials, network, or finance data. The private sidecar is NOT backup.json.
import {mergeRecords} from './landa-record-merge.mjs';
export const AUX_KEYS={
 expenses:'landa_expenses_standalone_v1',
 receiving:'landa_receiving_counts_v1',
 aliases:'landa_receiving_product_aliases_v1',
 moysklad:'landa_moysklad_name_links_v1',
 pallets:'landa_sdek_mixed_pallet_v1'
};
export const AUX_COLLECTIONS=Object.keys(AUX_KEYS);
export const emptyAux=()=>({app:'LANDA-aux-sync',version:1,collections:{
 expenses:{},receiving:{},aliases:{},moysklad:{},pallets:{}
}});
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const copy=v=>JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const recordMap=items=>{
 const out=Object.create(null);
 for(const [k,v] of items){
  if(typeof k!=='string'||!k||k.length>800||own(out,k))throw Error('Некорректный или повторяющийся ключ записи.');
  out[k]=v;
 }
 return out;
};
export function parseLocalAux(storage){
 const read=key=>{const s=storage.getItem(key);return s===null?null:JSON.parse(s)};
 const exp=read(AUX_KEYS.expenses),counts=read(AUX_KEYS.receiving),
  aliases=read(AUX_KEYS.aliases),ms=read(AUX_KEYS.moysklad),pallets=read(AUX_KEYS.pallets);
 const result=emptyAux(),c=result.collections;
 if(exp!==null){if(exp.version!==1||!Array.isArray(exp.entries))throw Error('Повреждён журнал расходов.');
  c.expenses=recordMap(exp.entries.map(e=>[e.id,e]));}
 if(counts!==null){if(counts.version!==1||!counts.entries||Array.isArray(counts.entries)||typeof counts.entries!=='object')throw Error('Повреждён журнал сверки товаров.');
  c.receiving=recordMap(Object.entries(counts.entries));}
 if(aliases!==null){if(aliases.version!==1||!Array.isArray(aliases.groups))throw Error('Повреждены объединения товаров.');
  c.aliases=recordMap(aliases.groups.map(g=>[g.id,g]));}
 if(ms!==null){if(!ms||typeof ms!=='object'||Array.isArray(ms))throw Error('Повреждены связи «МойСклад».');
  c.moysklad=recordMap(Object.entries(ms));}
 if(pallets!==null){if(pallets.version!==1||!Array.isArray(pallets.sessions))throw Error('Повреждены приёмки паллетов.');
  c.pallets=recordMap(pallets.sessions.map(v=>[v.id,v]));}
 return validateAux(result);
}
export function validateAux(data){
 if(!data||data.app!=='LANDA-aux-sync'||data.version!==1||!data.collections||typeof data.collections!=='object')
  throw Error('Неизвестный формат облачных дополнительных данных.');
 const result=emptyAux();
 for(const section of AUX_COLLECTIONS){
  const items=data.collections[section];
  if(!items||typeof items!=='object'||Array.isArray(items)||Object.keys(items).length>20000)throw Error('Повреждён раздел '+section);
  const rows=Object.entries(items);
  const out=Object.create(null);
  for(const [key,value] of rows){
   if(!key||key.length>800||own(out,key))throw Error('Некорректный ключ в '+section);
   if(!value||typeof value!=='object'||Array.isArray(value)){if(section!=='moysklad'||typeof value!=='string')throw Error('Некорректная запись в '+section);}
   if(section==='moysklad'&&(typeof value!=='string'||value.length>250))throw Error('Некорректная связь «МойСклад».');
   if(['expenses','aliases','pallets'].includes(section)&&value?.id!==key)throw Error('ID записи не совпадает с ключом: '+section);
   if(section==='receiving'&&(typeof value!=='object'||Array.isArray(value)))throw Error('Некорректная сверка.');
   out[key]=copy(value);
  }
  result.collections[section]=out;
 }
 return result;
}
export function mergeAux(base,local,remote){
 const b=validateAux(base),l=validateAux(local),r=validateAux(remote),merged=emptyAux(),conflicts=[];
 for(const section of AUX_COLLECTIONS){
  const srcB=b.collections[section],srcL=l.collections[section],srcR=r.collections[section],dest=Object.create(null);
  const keys=new Set([...Object.keys(srcB),...Object.keys(srcL),...Object.keys(srcR)]);
  for(const key of keys){
   const baseVal=own(srcB,key)?srcB[key]:null,localVal=own(srcL,key)?srcL[key]:null,remoteVal=own(srcR,key)?srcR[key]:null;
   const localChanged=!same(baseVal,localVal),remoteChanged=!same(baseVal,remoteVal);
   if(localChanged&&remoteChanged&&!same(localVal,remoteVal)){
    if(section==='pallets'&&baseVal&&localVal&&remoteVal){
     const changedJournal=x=>!same(x.entries,baseVal.entries)||!same(x.invoices,baseVal.invoices);
     // A pallet being finalized while another device is still loading needs
     // explicit review before it can be billed to the supplier.
     if((localVal.closed!==baseVal.closed&&changedJournal(remoteVal))||
      (remoteVal.closed!==baseVal.closed&&changedJournal(localVal))){
      conflicts.push({section,key});continue;
     }
     const deep=mergeRecords(baseVal,localVal,remoteVal,{arrayIds:{invoices:'key',entries:'id'}});
     if(!deep.conflicts.length){
      // Entries were created on different devices: restore chronological order
      // without changing any recorded place, quantity or original timestamp.
      deep.merged.entries.sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))||
       String(a.id).localeCompare(String(b.id)));
      dest[key]=deep.merged;continue;
     }
    }
    conflicts.push({section,key});continue;
   }
   const winner=localChanged?localVal:remoteVal;
   if(winner!==null)dest[key]=winner;
  }
  merged.collections[section]=dest;
 }
 if(conflicts.length)return {merged:null,conflicts};
 return {merged:validateAux(merged),conflicts:[]};
}
export function auxToLocalWrites(aux,storage,base=null){
 const clean=validateAux(aux),c=clean.collections;
 // Missing local datasets after previous syncing may indicate cleared storage.
 // Refuse to turn that into mass deletion of cloud data.
 if(base){
  const prior=validateAux(base);
  for(const section of AUX_COLLECTIONS){
   if(storage.getItem(AUX_KEYS[section])===null&&Object.keys(prior.collections[section]).length)
    throw Error('Исчез локальный раздел '+section+'. Синхронизация приостановлена, чтобы не удалить данные из облака.');
  }
 }
 const entries=Object.values(c.expenses),groups=Object.values(c.aliases),sessions=Object.values(c.pallets);
 const members=new Set();
 for(const group of groups){
  if(!Array.isArray(group.members)||group.members.length<2)throw Error('Некорректное объединение товара.');
  for(const member of group.members){
   if(members.has(member))throw Error('Конфликт правил объединения товаров. Требуется ручная проверка.');
   members.add(member);
  }
 }
 return {
  [AUX_KEYS.expenses]:JSON.stringify({version:1,entries}),
  [AUX_KEYS.receiving]:JSON.stringify({version:1,entries:c.receiving}),
  [AUX_KEYS.aliases]:JSON.stringify({version:1,groups}),
  [AUX_KEYS.moysklad]:JSON.stringify(c.moysklad),
  [AUX_KEYS.pallets]:JSON.stringify({version:1,sessions})
 };
}
export const auxEqual=(a,b)=>same(validateAux(a),validateAux(b));
export function applyAuxStorage(storage,writes){
 const previous={};
 for(const [key,value] of Object.entries(writes))previous[key]=storage.getItem(key);
 const written=[];
 try{
  for(const [key,value] of Object.entries(writes)){
   storage.setItem(key,value);
   if(storage.getItem(key)!==value)throw Error('Браузер не подтвердил сохранение '+key);
   written.push(key);
  }
 }catch(e){
  for(const key of written.reverse()){try{
   if(previous[key]===null)storage.removeItem(key);else storage.setItem(key,previous[key]);
  }catch(_){}}
  throw e;
 }
}
