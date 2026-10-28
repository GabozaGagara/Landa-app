/* LANDA browser safety snapshots. Additive IndexedDB backup; no credentials stored. */
(function(){
'use strict';
if(typeof ops==='undefined'||typeof state==='undefined')return;
const $=id=>document.getElementById(id);
if(!$('lcMakeBackup'))return;
const name='landa_safe_snapshots_v1',store='versions',maxStored=12;
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let timer=0,inFlight=false,lastSignature='';
function status(msg){const x=$('lcBackupStatus');if(x)x.textContent=msg;}
function openDatabase(){
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(Error('IndexedDB недоступна в этом браузере'));
  const r=indexedDB.open(name,1);
  r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:'id'})};
  r.onerror=()=>reject(r.error||Error('Ошибка открытия хранилища'));
  r.onsuccess=()=>resolve(r.result);
 });
}
function readAll(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();
  r.onsuccess=()=>resolve(r.result||[]);
  r.onerror=()=>reject(r.error||Error('Ошибка чтения копий'));
 });
}
function change(db,data){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readwrite');
  tx.objectStore(store).put(data);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('Ошибка записи версии'));
 });
}
function remove(db,id){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readwrite');
  tx.objectStore(store).delete(id);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('Ошибка удаления версии'));
 });
}
function capture(){
 return {app:'LANDA-suite',backupVersion:3,createdAt:new Date().toISOString(),proschet:JSON.parse(JSON.stringify(state)),operations:JSON.parse(JSON.stringify(ops))};
}
async function createBackup(manual){
 if(inFlight)return;
 inFlight=true;let db=null;
 try{
  const snapshot=capture();
  if(!manual&&!snapshot.proschet.rows.length&&!snapshot.operations.invoices.length)return;
  const data=JSON.stringify(snapshot);
  let h=2166136261;for(let i=0;i<data.length;i++)h=Math.imul(h^data.charCodeAt(i),16777619);
  const signature=data.length+'-'+(h>>>0).toString(16);
  if(!manual&&lastSignature===signature)return;
  db=await openDatabase();
  const last=await readAll(db);
  if(!manual&&last.length){
   const latest=last.sort((a,b)=>b.id.localeCompare(a.id))[0];
   if(Date.now()-Date.parse(latest.at)<120000)return;
  }
  const at=new Date(),id=at.toISOString()+'-'+Math.random().toString(36).slice(2,8);
  await change(db,{id,at:at.toISOString(),type:manual?'ручная':'автоматическая',data});
  const list=await readAll(db);
  for(const entry of list.sort((a,b)=>b.id.localeCompare(a.id)).slice(maxStored))await remove(db,entry.id);
  lastSignature=signature;
  status('✓ Локальная резервная версия создана '+at.toLocaleString('ru-RU')+'. Хранится только на этом устройстве.');
 }catch(e){status('Не удалось создать резервную версию: '+e.message+'. Скачайте полную JSON-копию вручную.')}
 finally{if(db)db.close();inFlight=false}
}
function download(contents,name){
 const blob=new Blob([contents],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function listBackups(){
 let db;
 try{
  db=await openDatabase();
  const list=(await readAll(db)).sort((a,b)=>b.id.localeCompare(a.id));
  const area=$('lcBackups');area.innerHTML=list.map(x=>'<div class="lc-row"><div><b>'+esc(new Date(x.at).toLocaleString('ru-RU'))+'</b><p>'+esc(x.type)+' · '+(x.data.length/1024).toFixed(0)+' КБ</p></div><button type="button" class="lc-btn" data-lc-download-version="'+esc(x.id)+'">Скачать JSON</button></div>').join('')||'<p class="lc-muted">Резервных версий пока нет.</p>';
  status('На этом устройстве '+list.length+' резервных версий. Восстановление доступно через встроенный импорт LANDA.');
 }catch(e){status('Не удалось прочитать резервные версии: '+e.message)}
 finally{if(db)db.close()}
}
async function downloadVersion(id){
 let db;
 try{
  db=await openDatabase();const list=await readAll(db);const v=list.find(x=>x.id===id);
  if(!v)return status('Резервная версия не найдена');
  download(v.data,'LANDA-локальная-версия-'+v.at.slice(0,19).replace(/[:T]/g,'-')+'.json');
  status('JSON сохранён. Для восстановления используй «Восстановить копию» в LANDA.');
 }catch(e){status('Не удалось скачать версию: '+e.message)}
 finally{if(db)db.close()}
}
$('lcMakeBackup').addEventListener('click',async()=>{await createBackup(true);await listBackups()});
$('lcListBackups').addEventListener('click',listBackups);
$('lcBackups').addEventListener('click',e=>{const b=e.target.closest('[data-lc-download-version]');if(b)downloadVersion(b.dataset.lcDownloadVersion)});
window.addEventListener('landa:data-changed',()=>{clearTimeout(timer);timer=setTimeout(()=>createBackup(false),3000)});
status('Автоматические локальные версии создаются при изменениях, не чаще одного раза за 2 минуты. GitHub остаётся основным облачным хранилищем.');
})();