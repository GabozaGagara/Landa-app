// Automatic companion sync: expenses, manual receiving, product aliases,
// MoySklad name links and mixed pallet intake. Uses the configured private
// GitHub repository and the token already kept by LANDA's finance sync.
// Does NOT write the financial backup.json or access Cloudflare secrets.
import {
 AUX_KEYS,AUX_COLLECTIONS,emptyAux,validateAux,parseLocalAux,mergeAux,
 auxToLocalWrites,auxEqual,applyAuxStorage
} from './landa-aux-sync-core.mjs';
import {readExpenseBook} from './landa-expenses-core.mjs';
import {palletValidate} from './landa-pallet-core.mjs';
import {safeProductAliases} from './landa-receiving-core.mjs';

if(typeof document!=='undefined'){
 const confKey='landa_github_sync_v1',tokKey='landa_github_token_v1',baseKey='landa_aux_sync_base_v1';
 const el=id=>document.getElementById(id);
 const cloudPath='landa-data/auxiliary-sync.json';
 let busy=false,timer=0,pending=false,last=0,paused=false,errors=0;
 const read=(area,key)=>{try{return area.getItem(key)}catch(_){return null}};
 const json=(raw)=>{try{return JSON.parse(raw||'null')}catch(_){return null}};
 const validRepo=repo=>/^[\w.-]+\/[\w.-]+$/.test(repo);
 function settings(){
  const cfg=json(read(localStorage,confKey));
  if(!cfg?.repo||!cfg?.path||!cfg.auto)return null;
  const token=read(cfg.remember?localStorage:sessionStorage,tokKey);
  if(!token||!validRepo(cfg.repo))return null;
  return {repo:cfg.repo,token,remember:!!cfg.remember};
 }
 function info(message,isError=false){
  const status=el('ghExtraStatus');
  if(status){status.textContent=message;status.style.color=isError?'#b13b4b':'#376382';}
  const sidebar=el('githubExtraSide');
  if(sidebar){sidebar.textContent=message;sidebar.title=message;}
 }
 const url=cfg=>'https://api.github.com/repos/'+cfg.repo.split('/').map(encodeURIComponent).join('/')+'/contents/'+cloudPath.split('/').map(encodeURIComponent).join('/');
 async function request(cfg,method='GET',data=null,sha=''){
  const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+cfg.token,'X-GitHub-Api-Version':'2022-11-28'};
  const opts={method,headers,cache:'no-store'};
  if(method==='PUT'){
   headers['Content-Type']='application/json';
   opts.body=JSON.stringify({message:'LANDA: синхронизация расходов и приёмки '+new Date().toISOString(),
    content:encode(JSON.stringify(data)),...(sha?{sha}:{})});
  }
  const response=await fetch(url(cfg),opts);
  let result={};try{result=await response.json()}catch(_){}
  if(response.status===409||response.status===422)throw Error('Облачный файл изменился во время записи. Повторяем проверку.');
  if(response.status!==404&&!response.ok)throw Error('GitHub HTTP '+response.status+'. Проверь подключение приватного репозитория.');
  return {status:response.status,data:result};
 }
 function encode(str){
  const bytes=new TextEncoder().encode(str);let output='';
  for(let i=0;i<bytes.length;i+=0x8000)output+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(output);
 }
 function decode(str){
  const binary=atob(str.replace(/\s/g,'')),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
 }
 async function verifyPrivate(cfg){
  const endpoint='https://api.github.com/repos/'+cfg.repo.split('/').map(encodeURIComponent).join('/');
  const response=await fetch(endpoint,{headers:{
   Accept:'application/vnd.github+json',Authorization:'Bearer '+cfg.token,
   'X-GitHub-Api-Version':'2022-11-28'
  },cache:'no-store'});
  if(!response.ok)throw Error('Нет доступа к приватному GitHub (HTTP '+response.status+').');
  const metadata=await response.json();
  if(metadata.private!==true)throw Error('Репозиторий не приватный. Синхронизация личных данных запрещена.');
 }
 async function getCloud(cfg){
  const response=await request(cfg);
  if(response.status===404)return null;
  if(!response.data?.sha||!response.data.content)throw Error('GitHub не вернул содержимое дополнительной копии.');
  return {sha:response.data.sha,aux:validateAux(JSON.parse(decode(response.data.content)))};
 }
 function getBase(cfg){
  const saved=json(read(localStorage,baseKey));
  if(saved?.repo===cfg.repo&&saved?.path===cloudPath&&saved.data){
   try{return validateAux(saved.data)}catch(_){}
  }
  return emptyAux();
 }
 function setBase(cfg,doc){
  const raw=JSON.stringify({repo:cfg.repo,path:cloudPath,data:validateAux(doc)});
  localStorage.setItem(baseKey,raw);
  if(localStorage.getItem(baseKey)!==raw)throw Error('Не удалось сохранить контрольную версию синхронизации.');
 }
 function validateDomain(doc){
  const c=validateAux(doc).collections;
  readExpenseBook({version:1,entries:Object.values(c.expenses)});
  palletValidate({version:1,sessions:Object.values(c.pallets)});
  const groups=Object.values(c.aliases),clean=safeProductAliases({version:1,groups});
  if(clean.groups.length!==groups.length||clean.groups.some((v,i)=>v.members.length!==groups[i].members.length))
   throw Error('Объединения товаров несовместимы, синхронизация остановлена.');
  for(const entry of Object.values(c.receiving)){
   if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Повреждена запись сверки.');
  }
  return doc;
 }
 function liveRaw(){
  return Object.fromEntries(Object.values(AUX_KEYS).map(key=>[key,read(localStorage,key)]));
 }
 function sameRaw(a,b){return JSON.stringify(a)===JSON.stringify(b)}
 function unsafeToReload(){
  const e=document.activeElement;
  if(document.querySelector('dialog[open]:not(#githubDialog)')||e?.matches?.('input,textarea,select,[contenteditable="true"]'))return true;
  if((el('exAmount')?.value||'').trim()||(el('exDescription')?.value||'').trim())return true;
  return false;
 }
 function notifyUpdated(){
  info('✓ Дополнительные данные обновлены из облака.');
  window.dispatchEvent(new Event('landa:aux-cloud-updated'));
  // These views cache their own localStorage snapshots. A reload is required to
  // prevent an old in-memory journal overwriting freshly synchronized data.
  window.location.reload();
 }
 async function sync(){
  const cfg=settings();
  if(!cfg){info('Доп. данные: подключите GitHub и включите автосинхронизацию.');return}
  if(busy){pending=true;return}
  if(unsafeToReload()){pending=true;return}
  busy=true;last=Date.now();
  try{
   const originalRaw=liveRaw(),local=validateDomain(parseLocalAux(localStorage)),base=getBase(cfg);
   await verifyPrivate(cfg);
   const remote=await getCloud(cfg),cloud=remote?.aux||emptyAux();
   const outcome=mergeAux(base,local,cloud);
   if(outcome.conflicts.length){
    paused=true;
    info('⚠ Конфликт '+outcome.conflicts.length+' записей в расходах/приёмке. Ничего не перезаписано. Сохраните JSON-копии на обоих устройствах.',true);
    return;
   }
   const merged=validateDomain(outcome.merged),cloudChanged=!auxEqual(merged,cloud),localChanged=!auxEqual(merged,local);
   if(!sameRaw(liveRaw(),originalRaw)){pending=true;return}
   const writes=auxToLocalWrites(merged,localStorage,base);
   // Do not overwrite a person's unsaved form after a network round trip.
   if(localChanged&&unsafeToReload()){pending=true;return}
   // If not connected to private repo we will never create a new file.
   if(!remote&&Object.values(merged.collections).every(x=>!Object.keys(x).length)){
    info('✓ Синхронизация расходов и приёмки готова; записей пока нет.');
    return;
   }
   if(cloudChanged){
    const payload=JSON.stringify(merged);
    if(new TextEncoder().encode(payload).length>850000)
     throw Error('Дополнительные журналы слишком большие для GitHub Contents API. Скачайте резервные копии.');
    // SHA compare-and-swap prevents losing updates written on another device.
    const result=await request(cfg,'PUT',merged,remote?.sha||'');
    if(![200,201].includes(result.status)||!result.data?.content?.sha)
     throw Error('GitHub не подтвердил сохранение дополнительного журнала.');
   }
   // A new baseline is saved ONLY after the cloud has accepted the write.
   // Re-check that no local edit arrived while the GitHub PUT was in flight.
   if(!sameRaw(liveRaw(),originalRaw)){
    // PUT succeeded, so record the new cloud base before merging later local changes.
    // This ensures the next sync sees those changes as local-only modifications.
    setBase(cfg,merged);
    pending=true;
    return;
   }
   if(localChanged)applyAuxStorage(localStorage,writes);
   setBase(cfg,merged);
   paused=false;errors=0;
   if(localChanged)notifyUpdated();
   else info('✓ Расходы, сверка, паллеты и настройки приёмки синхронизированы.');
  }catch(e){
   errors++;
   info('⚠ Синхронизация дополнительных данных: '+e.message,true);
   // A collision should be re-read on the next periodic check.
  }finally{
   busy=false;
   if(pending){pending=false;schedule(5000);}
  }
 }
 function schedule(delay=3500){
  if(!settings())return;
  clearTimeout(timer);
  timer=setTimeout(()=>void sync(),delay);
 }
 window.addEventListener('landa:aux-data-changed',()=>schedule(1600));
 window.addEventListener('landa:github-config-saved',()=>schedule(1000));
 window.addEventListener('landa:github-disconnected',()=>{
  clearTimeout(timer);info('Дополнительная синхронизация отключена.');
 });
 window.addEventListener('focus',()=>{if(Date.now()-last>20000)schedule(1800)});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-last>20000)schedule(1800)});
 window.setInterval(()=>{if(!document.hidden&&Date.now()-last>35000)schedule(1000)},40000);
 const btn=el('ghExtrasNow');if(btn)btn.addEventListener('click',()=>schedule(0));
 if(settings())schedule(2200);
 else info('Доп. данные: для автосинхронизации нужно подключить GitHub.');
 window.LANDA_AUX_SYNC={syncNow:()=>schedule(0)};
}
