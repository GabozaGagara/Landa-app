/* LANDA Prosсhet B UI. Read-only financial view; UI annotations live in separate localStorage. */
import {totalsAt,groupView,biggestChanges,duplicateSuggestions,rowArchiveVisible,valueAt} from './landa-proschet-b-core.mjs';
if(typeof document!=='undefined'&&typeof state!=='undefined'&&typeof snap!=='undefined'&&document.getElementById('proschetPage')){
 const KEY='landa_proschet_b_prefs_v1', $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const fmtNum=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
 const amount=n=>(n<0?'−':'')+fmtNum(Math.abs(n))+' ₽';
 const blank=()=>({version:1,mode:'compact',favorites:[],checks:{},comments:{},archive:{},folded:{},showArchived:false});
 let prefs=blank(),expanded=new Set(),commentFor=null;
 try{
  const data=JSON.parse(localStorage.getItem(KEY)||'null');
  if(data&&data.version===1&&typeof data==='object'){
   prefs={...blank(),...data,favorites:Array.isArray(data.favorites)?data.favorites.filter(v=>typeof v==='string'):[],
    checks:data.checks&&typeof data.checks==='object'&&!Array.isArray(data.checks)?data.checks:{},
    comments:data.comments&&typeof data.comments==='object'&&!Array.isArray(data.comments)?data.comments:{},
    archive:data.archive&&typeof data.archive==='object'&&!Array.isArray(data.archive)?data.archive:{},
    folded:data.folded&&typeof data.folded==='object'&&!Array.isArray(data.folded)?data.folded:{}};
  }
 }catch(_){}
 const styles=document.createElement('style');
 styles.textContent=[
 '.pb-toolbar{border:1px solid #d9e5f3;background:#fff;border-radius:13px;padding:14px 16px;margin:14px 0}',
 '.pb-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}',
 '.pb-title{font-size:15px;font-weight:800;color:#203653}.pb-desc{font-size:12px;color:#62768e;margin-top:5px;line-height:1.5}',
 '.pb-tabs{display:flex;flex-wrap:wrap;gap:5px}.pb-tabs button,.pb-small{border:1px solid #cdd9ec;border-radius:8px;background:#fff;color:#234a79;padding:7px 10px;cursor:pointer;font:inherit;font-size:12px}',
 '.pb-tabs button[aria-pressed=true]{background:#305bd0;color:white;border-color:#305bd0}.pb-small:focus-visible,.pb-tabs button:focus-visible{outline:2px solid #315ed2}',
 '.pb-notice{font-size:12px;color:#61728a;padding:9px 12px;border-radius:8px;background:#f1f5fc;margin:10px 0}',
 '.pb-line{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:11px 3px;border-bottom:1px solid #e5ecf5}',
 '.pb-line strong{font-size:14px;color:#243d62}.pb-line small{font-size:11px;color:#6e7d90}',
 '.pb-outer{border:1px solid #dfe7f2;border-radius:13px;background:white;margin:10px 0;overflow:hidden}',
 '.pb-group-head{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;background:#f7f9fd;gap:12px}',
 '.pb-group-head strong{font-size:15px}.pb-group-body{padding:6px 15px 12px}',
 '.pb-sub{border-top:1px solid #e9eef6;margin-top:7px}.pb-sub-summary{padding:11px 0;display:flex;justify-content:space-between;gap:10px;align-items:center}',
 '.pb-rows{padding:1px 0 5px 12px}.pb-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #eef2f6}',
 '.pb-row-name{font-size:13px;font-weight:600;overflow-wrap:anywhere}.pb-controls{display:flex;gap:5px;flex-wrap:wrap;align-items:center;justify-content:flex-end}',
 '.pb-control{border:1px solid #d5dfed;background:#fff;border-radius:7px;padding:4px 7px;font-size:12px;color:#3b5875;cursor:pointer}',
 '.pb-control[data-active=true]{border-color:#80b8a3;background:#e9f6ef;color:#186147}.pb-control.fav[data-active=true]{color:#9a6910;border-color:#ecd398;background:#fff8e7}',
 '.pb-meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.pb-count{font-size:12px;color:#566f8d}.pb-ok{color:#148063;font-weight:700}',
 '.pb-warning{font-size:12px;color:#95600e;background:#fff8e8;padding:9px 11px;border-radius:9px;margin:8px 0}',
 '.pb-inline{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}.pb-inline .pb-control{padding:3px 5px;font-size:11px}',
 '.pb-note{color:#59738e;font-size:11px;white-space:normal}.pb-dialog{width:min(510px,calc(100vw - 18px));padding:19px;border:1px solid #d7e2f0;border-radius:14px;color:#21364f}',
 '.pb-dialog textarea{width:100%;min-height:110px;border:1px solid #c8d7e7;padding:10px;border-radius:8px;font:inherit;margin:12px 0}',
 '.pb-dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
 '@media(max-width:640px){.pb-row{grid-template-columns:1fr}.pb-controls{justify-content:flex-start}.pb-toolbar{padding:12px}}'
 ].join('');
 document.head.append(styles);
 const page=$('proschetPage'),native=$('groups');
 const toolbar=document.createElement('section');
 toolbar.className='pb-toolbar';toolbar.id='pbToolbar';
 toolbar.innerHTML='<div class="pb-top"><div><div class="pb-title">Финансовый просчёт · Вариант B</div><div class="pb-desc">Новый вид без изменения исходных расчётов. Классический режим всегда доступен.</div></div>'+
  '<div class="pb-tabs" role="group" aria-label="Режим просмотра">'+
  '<button type="button" data-pb-mode="compact">Кратко</button>'+
  '<button type="button" data-pb-mode="detail">Подробно</button>'+
  '<button type="button" data-pb-mode="changes">Изменения</button>'+
  '<button type="button" data-pb-mode="classic">Классический</button></div></div>'+
  '<div class="pb-line"><span id="pbChecked" class="pb-count"></span>'+
  '<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input id="pbShowArchived" type="checkbox"> Показывать архивные строки</label></div>'+
  '<div class="pb-desc">Быстрая проверка: ✓ — подтверждено для текущего значения; ☆ — избранное; ✎ — причина или комментарий; ⤓ — скрыть в архив с этой даты.</div>'+
  '<div class="pb-notice">Отметки, комментарии, избранное и архив хранятся только в этом браузере, не синхронизируются с GitHub. Архив меняет видимость, но НЕ исключает сумму из финансового итога.</div>';
 page.querySelector('.sectionbar')?.before(toolbar);
 const panel=document.createElement('div');panel.id='pbView';native.before(panel);
 const dialog=document.createElement('dialog');dialog.className='pb-dialog';dialog.id='pbComment';
 dialog.innerHTML='<h3 style="margin:0">Причина изменения / комментарий</h3><div id="pbCommentTitle" class="pb-desc"></div>'+
  '<textarea id="pbCommentValue" maxlength="600" placeholder="Например: сверено по выписке, поступление средств, исправление ошибки"></textarea>'+
  '<div class="pb-dialog-actions"><button id="pbCommentCancel" class="pb-small" type="button">Отмена</button><button id="pbCommentSave" class="pb-small" type="button">Сохранить комментарий</button></div>';
 document.body.append(dialog);
 const noteKey=rowId=>JSON.stringify([snap,rowId]);
 const statusKey=rowId=>JSON.stringify([snap,rowId]);
 const marker=row=>JSON.stringify([Object.prototype.hasOwnProperty.call(row.values,snap),valueAt(row,snap)]);
 function isChecked(row){const chk=prefs.checks[statusKey(row.id)];return !!(chk&&chk.value===marker(row))}
 function inArchive(row){return !rowArchiveVisible(prefs,row.id,state.snapshots,snap)}
 function persist(){
  try{const raw=JSON.stringify(prefs);localStorage.setItem(KEY,raw);if(localStorage.getItem(KEY)!==raw)throw Error('write failed');return true}
  catch(_){alert('Не удалось записать настройки просчёта. Финансовые данные не затронуты.');return false}
 }
 function changePrefs(fn){const original=JSON.stringify(prefs);fn();if(!persist()){prefs=JSON.parse(original);return}draw()}
 function controls(row){
  const favorite=prefs.favorites.includes(row.id),checked=isChecked(row),archived=inArchive(row);
  const note=prefs.comments[noteKey(row.id)]||row.notes?.[snap]||'';
  return '<span class="pb-controls">'+
   '<button class="pb-control fav" type="button" data-pb-act="favorite" data-pb-row="'+esc(row.id)+'" data-active="'+favorite+'" title="Избранное" aria-label="Избранное '+esc(row.name)+'">'+(favorite?'★':'☆')+'</button>'+
   '<button class="pb-control" type="button" data-pb-act="check" data-pb-row="'+esc(row.id)+'" data-active="'+checked+'" title="Быстрая проверка" aria-label="Проверка '+esc(row.name)+'">'+(checked?'✓ Проверено':'○ Проверить')+'</button>'+
   '<button class="pb-control" type="button" data-pb-act="comment" data-pb-row="'+esc(row.id)+'" title="Причины и комментарии" aria-label="Комментарий '+esc(row.name)+'">✎'+(note?' •':'')+'</button>'+
   '<button class="pb-control" type="button" data-pb-act="archive" data-pb-row="'+esc(row.id)+'" title="'+(archived?'Вернуть из архива':'Архивировать с текущей даты')+'" aria-label="Архив '+esc(row.name)+'">'+(archived?'↥':'⤓')+'</button></span>';
 }
 function visibleRows(rows){return rows.filter(r=>(typeof matches==='function'?matches(r):true) &&(prefs.showArchived||!inArchive(r)))}
 function rowDisplay(row){
  const note=prefs.comments[noteKey(row.id)]||row.notes?.[snap]||'';
  return '<div class="pb-row"><div><div class="pb-row-name">'+esc(row.name)+'</div>'+
   '<small>'+esc(row.subgroup||'')+(inArchive(row)?' · архив':'')+(note?' · '+esc(note.slice(0,90)):'')+'</small></div>'+
   '<div style="text-align:right"><strong>'+amount(valueAt(row,snap))+'</strong><div class="pb-controls">'+
   '<button type="button" class="pb-control" data-pb-jump="'+esc(row.id)+'" title="Открыть строку для редактирования">Открыть</button>'+controls(row)+'</div></div></div>';
 }
 function drawCompact(){
  const groups=groupView(state,snap);
  const favorites=state.rows.filter(r=>prefs.favorites.includes(r.id) &&(prefs.showArchived||!inArchive(r)));
  const favs=favorites.length?'<section class="pb-outer"><div class="pb-group-head"><strong>★ Избранные позиции</strong><span class="pb-count">'+favorites.length+'</span></div><div class="pb-group-body">'+favorites.map(rowDisplay).join('')+'</div></section>':'';
  const blocks=groups.filter(g=>activeGroup==='all'||g.id===activeGroup).map(g=>{
   const subgroups=g.subgroups.map(sub=>{
    const id=JSON.stringify([g.id,sub.name]),rows=visibleRows(sub.rows);
    if(!rows.length)return '';
    const folded=!!prefs.folded[id];
    const nHidden=sub.rows.length-rows.length;
    return '<div class="pb-sub"><div class="pb-sub-summary"><button class="pb-small" data-pb-fold="'+esc(id)+'" type="button" aria-expanded="'+(!folded)+'">'+(folded?'▸':'▾')+' '+esc(sub.name)+' · '+rows.length+' строк</button>'+
     '<span><strong>'+amount(sub.total)+'</strong>'+(nHidden?'<small> · скрыто '+nHidden+'</small>':'')+'</span></div>'+
     (!folded?'<div class="pb-rows">'+rows.map(rowDisplay).join('')+'</div>':'')+'</div>';
   }).join('');
   if(!subgroups)return '';
   return '<section class="pb-outer"><div class="pb-group-head"><div><strong>'+esc(g.name)+'</strong>'+
    '<div class="pb-count">'+g.count+' позиций'+(!g.included?' · вне общего итога':'')+'</div></div><strong>'+amount(g.total)+'</strong></div>'+
    '<div class="pb-group-body">'+subgroups+'</div></section>';
  }).join('');
  return favs+blocks||'<div class="pb-notice">Нет строк, подходящих под фильтры. Попробуйте «Все» или режим «Подробно».</div>';
 }
 function drawChanges(){
  const change=biggestChanges(state,snap,15);
  if(!change.previous)return '<div class="pb-notice">Для этой даты нет предыдущего датированного расчёта. Сохранённые финансовые значения не менялись.</div>';
  const heading='<div class="pb-outer" style="padding:14px"><strong>Главные изменения</strong><div class="pb-desc">К предыдущему расчёту по календарной дате · '+change.changedCount+' изменённых позиций · общий итог: '+amount(change.totalDelta)+
   '</div><div class="pb-desc">Сумма изменений по строкам, входящим в итог: '+amount(change.allDelta)+'</div></div>';
  const rows=change.items.filter(x=>prefs.showArchived||!inArchive(state.rows.find(r=>r.id===x.id))).map(x=>
   '<div class="pb-line"><div><strong>'+esc(x.name)+'</strong><div class="pb-count">'+esc(x.subgroup||'')+(x.included?'':' · вне итога')+
   ' · было '+amount(x.previous)+' → стало '+amount(x.current)+'</div></div>'+
   '<div class="pb-controls"><strong style="color:'+(x.delta<0?'#b64b5a':'#16795a')+'">'+(x.delta>0?'+':'')+amount(x.delta)+'</strong>'+
   '<button type="button" class="pb-small" data-pb-jump="'+esc(x.id)+'">К строке</button></div></div>').join('');
  return heading+'<div class="pb-outer" style="padding:10px 15px">'+(rows||'<p class="pb-desc">Различий нет.</p>')+'</div>';
 }
 function drawDuplicates(){
  const suggestions=duplicateSuggestions(state.rows);
  return '<section class="pb-outer" style="padding:12px 15px"><strong>Возможные дубли</strong>'+
   '<div class="pb-desc">Совпадающие названия после нормализации в одном разделе. Подсказка — не основание объединять суммы.</div>'+
   (suggestions.length?suggestions.slice(0,30).map(g=>'<div class="pb-line"><div><strong>'+esc(g.name)+'</strong><div class="pb-count">'+
      g.items.map(it=>esc(it.name)+' ['+esc(it.subgroup||'')+']').join(' · ')+'</div></div><span class="pb-count">'+g.items.length+' строки</span></div>').join(''):
    '<div class="pb-desc" style="padding:10px 0">Совпадений не найдено.</div>')+'</section>';
 }
 function enhanceDetails(){
  if(prefs.mode!=='detail')return;
  for(const el of native.querySelectorAll('.item[data-row]')){
   if(el.querySelector('.pb-inline'))continue;
   const row=state.rows.find(r=>r.id===el.dataset.row);
   if(!row)continue;
   if(inArchive(row)&&!prefs.showArchived){el.hidden=true;continue}
   const area=el.querySelector('.item-meta');if(!area)continue;
   const block=document.createElement('span');block.className='pb-inline';
   block.innerHTML=controls(row)+(prefs.comments[noteKey(row.id)]?'<span class="pb-note">'+esc(prefs.comments[noteKey(row.id)].slice(0,140))+'</span>':'');
   area.append(block);
  }
 }
 function draw(){
  if(!$('pbToolbar')||!state?.rows)return;
  if(!['compact','detail','changes','classic'].includes(prefs.mode))prefs.mode='compact';
  toolbar.querySelectorAll('[data-pb-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pbMode===prefs.mode)));
  $('pbShowArchived').checked=!!prefs.showArchived;
  const shown=state.rows.filter(r=>(typeof matches==='function'?matches(r):true) &&(prefs.showArchived||!inArchive(r)));
  const checked=shown.filter(isChecked).length;
  $('pbChecked').textContent='Быстрая проверка: '+checked+' из '+shown.length+' видимых строк · непроверено '+(shown.length-checked);
  const isClassic=prefs.mode==='classic',isDetail=prefs.mode==='detail';
  panel.hidden=isClassic||isDetail;native.hidden=!isClassic&&!isDetail;
  $('pbView').innerHTML=prefs.mode==='compact'?drawCompact():
    prefs.mode==='changes'?drawChanges()+drawDuplicates():'';
  enhanceDetails();
 }
 function jump(id){
  const r=state.rows.find(v=>v.id===id);if(!r)return;
  prefs.mode='detail';prefs.showArchived=true;
  activeGroup=r.group;filter='all';searchText='';$('search').value='';
  if(typeof render==='function')render();else draw();
  const el=[...native.querySelectorAll('.item[data-row]')].find(n=>n.dataset.row===id);
  el?.scrollIntoView({block:'center',behavior:'smooth'});
 }
 function act(action,id){
  const row=state.rows.find(r=>r.id===id);if(!row)return;
  if(action==='favorite'){
   changePrefs(()=>{prefs.favorites=prefs.favorites.includes(id)?prefs.favorites.filter(x=>x!==id):[...prefs.favorites,id]});
  }else if(action==='check'){
   changePrefs(()=>{const key=statusKey(id);if(isChecked(row))delete prefs.checks[key];
    else prefs.checks[key]={value:marker(row),at:new Date().toISOString()};});
  }else if(action==='comment'){
   commentFor=id;
   $('pbCommentTitle').textContent=row.name+' · '+(state.snapshots.find(x=>x.id===snap)?.label||snap);
   $('pbCommentValue').value=prefs.comments[noteKey(id)]||'';
   dialog.showModal();$('pbCommentValue').focus();
  }else if(action==='archive'){
   const old=prefs.archive[id],archived=inArchive(row);
   if(!old&&!confirm('Архивировать «'+row.name+'» с текущей даты? Строка будет скрыта в новом виде, но её суммы ПРОДОЛЖАТ входить в итоги. Данные не удаляются.'))return;
   changePrefs(()=>{if(old)delete prefs.archive[id];else prefs.archive[id]=snap});
  }
 }
 toolbar.addEventListener('click',e=>{
  const mode=e.target.closest('[data-pb-mode]');if(mode){changePrefs(()=>{prefs.mode=mode.dataset.pbMode});if(prefs.mode==='detail'||prefs.mode==='classic')renderGroups();return}
  const action=e.target.closest('[data-pb-act]');if(action)act(action.dataset.pbAct,action.dataset.pbRow);
 });
 $('pbShowArchived').addEventListener('change',e=>{changePrefs(()=>{prefs.showArchived=e.target.checked});if(prefs.mode==='detail')renderGroups()});
 function delegated(e){
  const action=e.target.closest('[data-pb-act]');if(action){e.preventDefault();act(action.dataset.pbAct,action.dataset.pbRow);return}
  const go=e.target.closest('[data-pb-jump]');if(go){e.preventDefault();jump(go.dataset.pbJump);return}
  const fold=e.target.closest('[data-pb-fold]');if(fold){
   const key=fold.dataset.pbFold;changePrefs(()=>{prefs.folded[key]=!prefs.folded[key]});return;
  }
 }
 panel.addEventListener('click',delegated);
 native.addEventListener('click',delegated);
 $('pbCommentCancel').addEventListener('click',()=>dialog.close());
 $('pbCommentSave').addEventListener('click',()=>{
  if(!commentFor)return;
  const id=commentFor,v=$('pbCommentValue').value.trim();
  changePrefs(()=>{if(v)prefs.comments[noteKey(id)]=v;else delete prefs.comments[noteKey(id)]});
  dialog.close();commentFor=null;
 });
 window.addEventListener('landa:proschet-render',draw);
 draw();
}
