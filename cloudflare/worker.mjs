// LANDA: supplier-only API. Deployed to Cloudflare Worker, NEVER as GitHub Pages JS.
import {supplierOverview} from './supplier-view.mjs';
import {loadSupplies,validateRange,checkConnection} from './moysklad-read.mjs';
// Required secrets: GH_TOKEN (fine-grained PAT to private repo contents only),
// SUPPLIER_CODES (JSON of three 24+ character random passwords for each supplier).
const REPO='GabozaGagara/Landa-financenot',PATH='landa-data/backup.json',ORIGIN='https://gabozagagara.github.io';
const suppliers={anna:'Анна',alina:'Алина',anatoly:'Анатолий'};
const te=new TextEncoder(),td=new TextDecoder();
function response(obj,status=200,origin=''){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'}:{})}})}
function fail(message,code=400){const e=new Error(message);e.code=code;throw e}
function clean(x,max=150){return String(x??'').trim().slice(0,max)}
function normalizeInvoice(i){
 if(!i||i.app!=='LANDA-supplier-invoice'||i.schemaVersion!==1||!Object.hasOwn(suppliers,i.supplierId))fail('Неверный формат накладной');
 if(clean(i.origin).toLocaleLowerCase('ru')!=='брест')fail('Принимаются только отправления из Бреста');
 const destination=clean(i.destination,80);if(!destination)fail('Не указан город назначения');
 const tracking=clean(i.tracking,35).replace(/\s/g,'');if(!/^[A-Za-z0-9-]{8,35}$/.test(tracking))fail('Некорректный номер СДЭК');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(i.date||'')||!Number.isFinite(Date.parse(i.date+'T00:00:00Z'))||new Date(i.date+'T00:00:00Z').toISOString().slice(0,10)!==i.date)fail('Некорректная дата');
 if(!Array.isArray(i.items)||i.items.length<1||i.items.length>100)fail('Нужно от 1 до 100 товарных позиций');
 let totalCents=0,unknownPrices=0;
 const items=i.items.map(row=>{
  const name=clean(row.name,180),qty=Number(row.qty),price=row.price==null?null:Number(row.price);
  if(!name||!Number.isFinite(qty)||qty<=0||qty>100000)fail('Некорректное название или количество');
  if(price!==null&&(!Number.isFinite(price)||price<0||price>99999999))fail('Некорректная стоимость товара');
  if(price==null)unknownPrices++;else totalCents+=Math.round(qty*Math.round(price*100));
  if(!Number.isSafeInteger(totalCents)||totalCents>1e15)fail('Слишком большая стоимость');
  return {name,qty,price:price===null?0:Math.round(price*100)/100,sku:clean(row.sku,100)};
 });
 const delivery=i.deliveryCost==null?null:Number(i.deliveryCost);
 if(delivery!==null&&(!Number.isFinite(delivery)||delivery<0||delivery>99999999))fail('Некорректная доставка');
 return {supplierId:i.supplierId,tracking,date:i.date,sender:clean(i.sender,100),destination,items,goodsCost:totalCents/100,deliveryCost:delivery==null?0:Math.round(delivery*100)/100,deliveryMissing:delivery==null,unknownPrices,note:clean(i.note,280)};
}
function encode(bytes){let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out)}
function decode(str){const s=atob(str.replace(/\s/g,'')),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return td.decode(a)}
async function github(env,method='GET',sha='',data=null){
 if(!env.GH_TOKEN)fail('GitHub-токен не настроен на сервере',503);
 const body=data==null?undefined:JSON.stringify({message:'LANDA: supplier invoice '+new Date().toISOString(),sha,content:encode(te.encode(JSON.stringify(data)))});
 const r=await fetch('https://api.github.com/repos/'+REPO+'/contents/'+PATH,{method,headers:{'Authorization':'Bearer '+env.GH_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'LANDA-Supplier-Bridge',...(body?{'Content-Type':'application/json'}:{})},body});
 const d=await r.json().catch(()=>({}));
 if(method==='GET'){
  if(!r.ok||!d.sha||!d.content)fail('Не удалось прочитать приватную базу на GitHub (HTTP '+r.status+')',502);
  const backup=JSON.parse(decode(d.content));
  if(backup.app!=='LANDA-suite'||!backup.proschet||!backup.operations||!Array.isArray(backup.operations.invoices))fail('Неверный формат базы LANDA',502);
  return {sha:d.sha,backup};
 }
 if(r.status===409||r.status===422)return {conflict:true};
 if(!r.ok)fail('Не удалось сохранить накладную на GitHub (HTTP '+r.status+')',502);
 return {sha:d.content?.sha};
}
function constantEquals(a,b){let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0}
// Verifies access without writing to GitHub or exposing credentials or financial records.
function validateSupplierAccess(supplierId,code,env){
 if(!Object.hasOwn(suppliers,supplierId))fail('Неизвестный поставщик',400);
 let codes;try{codes=JSON.parse(env.SUPPLIER_CODES||'{}')}catch{fail('Коды доступа не настроены',503)}
 const candidate=String(code||''),expected=codes[supplierId];
 if(typeof expected!=='string'||expected.length<24||candidate.length<24||candidate.length>200||!constantEquals(candidate,expected))fail('Неверный код доступа поставщика',403);
}
// Separate owner-only access for the read-only warehouse integration.
function validateMoyskladAdmin(key,env){
 const expected=env.LANDA_MS_ADMIN_KEY;
 if(typeof expected!=='string'||expected.length<32)fail('Не настроен LANDA_MS_ADMIN_KEY в Cloudflare',503);
 const candidate=typeof key==='string'?key:'';
 if(candidate.length<32||candidate.length>256||!constantEquals(candidate,expected))fail('Неверный код владельца для интеграции МойСклад',403);
}
async function moyskladSupplies(request,env){
 const raw=await request.text();if(te.encode(raw).length>1500)fail('Слишком большой запрос',413);
 let data;try{data=JSON.parse(raw)}catch{fail('Неверный JSON')}
 if(!data||typeof data!=='object')fail('Некорректный запрос');
 validateMoyskladAdmin(data.adminKey,env);
 validateRange(data.from,data.to);
 return loadSupplies(env,data.from,data.to);
}
async function diagnose(request,env){
 const raw=await request.text();if(te.encode(raw).length>2000)fail('Слишком большой запрос',413);
 let d;try{d=JSON.parse(raw)}catch{fail('Неверный JSON')}
 validateSupplierAccess(d.supplierId,d.code,env);
 if(!env.GH_TOKEN)return {ok:false,step:'configuration',message:'GH_TOKEN отсутствует в рабочем окружении Cloudflare.'};
 const headers={'Authorization':'Bearer '+String(env.GH_TOKEN).trim(),'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'LANDA-Diagnostics'};
 const opts={method:'GET',headers,cache:'no-store'};
 const who=await fetch('https://api.github.com/user',opts);
 if(who.status!==200)return {ok:false,step:'token',http:who.status,message:who.status===401?'Токен GH_TOKEN недействителен или отозван.':'GitHub не подтвердил токен (HTTP '+who.status+').' };
 const identity=await who.json().catch(()=>({}));
 if(typeof identity.login==='string'&&identity.login.toLowerCase()!=='gabozagagara')return {ok:false,step:'owner',message:'Токен действителен, но относится не к аккаунту GabozaGagara.'};
 const repository=await fetch('https://api.github.com/repos/'+REPO,opts);
 if(repository.status!==200)return {ok:false,step:'repository',http:repository.status,message:repository.status===404?'Токен действителен, но не видит приватный Landa-financenot. Выбери этот репозиторий в Repository access токена.':'GitHub не открыл приватный репозиторий (HTTP '+repository.status+').' };
 const file=await fetch('https://api.github.com/repos/'+REPO+'/contents/'+PATH,opts);
 if(file.status!==200)return {ok:false,step:'file',http:file.status,message:file.status===404?'Репозиторий доступен, но Contents API не видит backup.json. Проверь право Contents: Read and write.':'Ошибка доступа к файлу (HTTP '+file.status+').' };
 return {ok:true,step:'read',message:'Токен действителен. Приватный репозиторий и JSON доступны для чтения. Возможность записи проверяется при отправке накладной.'};
}
async function submit(request,env){
 const raw=await request.text();if(te.encode(raw).length>50000)fail('Слишком большой запрос',413);
 let data;try{data=JSON.parse(raw)}catch{fail('Неверный JSON')}
 const i=normalizeInvoice(data.invoice);
 validateSupplierAccess(i.supplierId,data.code,env);
 for(let attempt=0;attempt<4;attempt++){
  const {sha,backup}=await github(env),ops=backup.operations;
  if(ops.invoices.some(x=>[x.number,x.tracking].some(z=>String(z||'').trim().toLowerCase()===i.tracking.toLowerCase())))return {duplicate:true,tracking:i.tracking};
  const now=new Date().toISOString();
  ops.nextSeq=(Number(ops.nextSeq)||0)+1;
  ops.invoices.push({id:'supplier_'+crypto.randomUUID(),seq:ops.nextSeq,supplierId:i.supplierId,date:i.date,number:i.tracking,tracking:i.tracking,moysklad:'',status:'created',reviewStatus:'pending',items:i.items,goodsCost:i.goodsCost,deliveryCost:i.deliveryCost,deliveryMissing:i.deliveryMissing,includeDelivery:true,total:Math.round(i.goodsCost*100+i.deliveryCost*100)/100,accrued:false,sender:i.sender,route:'Брест → '+i.destination,note:('Поставщик отправил '+now+'. Статус СДЭК не проверен. '+(i.unknownPrices?'Цены не указаны: '+i.unknownPrices+'. ':'')+(i.deliveryMissing?'Доставка не указана. ':'')+i.note).slice(0,490),submittedAt:now,trackingVerified:false});
  if(!Array.isArray(ops.auditTrail))ops.auditTrail=[];
  ops.auditTrail.push({id:'evt-'+crypto.randomUUID(),at:now,type:'created',recordId:ops.invoices[ops.invoices.length-1].id,summary:'Поставщик '+suppliers[i.supplierId]+' создал накладную '+i.tracking,source:'supplier:'+i.supplierId});
  ops.auditTrail=ops.auditTrail.slice(-900);
  const saved=await github(env,'PUT',sha,backup);if(!saved.conflict)return {created:true,tracking:i.tracking};
 }
 fail('База обновилась одновременно; попробуйте ещё раз',409);
}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin')||'';
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'3600'}});
 try{
  const u=new URL(request.url);
  if(u.pathname==='/health'&&request.method==='GET')return response({app:'LANDA-supplier-bridge',github:!!env.GH_TOKEN},200,origin);
  if(u.pathname==='/admin/moysklad-check'&&request.method==='POST'){
   if(origin!==ORIGIN)fail('Недопустимый источник',403);
   if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/json')fail('Ожидается application/json');
   const raw=await request.text();if(te.encode(raw).length>1500)fail('Слишком большой запрос',413);
   let data;try{data=JSON.parse(raw)}catch{fail('Неверный JSON')}
   validateMoyskladAdmin(data?.adminKey,env);
   return response(await checkConnection(env),200,origin);
  }
  if(u.pathname==='/admin/moysklad-supplies'&&request.method==='POST'){
   if(origin!==ORIGIN)fail('Недопустимый источник',403);
   if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/json')fail('Ожидается application/json');
   return response(await moyskladSupplies(request,env),200,origin);
  }
  if(u.pathname==='/diagnose'&&request.method==='POST'){
   if(origin!==ORIGIN)fail('Недопустимый источник',403);
   if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/json')fail('Ожидается application/json');
   return response(await diagnose(request,env),200,origin);
  }
  if(u.pathname==='/supplier-overview'&&request.method==='POST'){
   if(origin!==ORIGIN)fail('Недопустимый источник',403);
   if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/json')fail('Ожидается application/json');
   const raw=await request.text();if(te.encode(raw).length>2000)fail('Слишком большой запрос',413);
   let data;try{data=JSON.parse(raw)}catch{fail('Неверный JSON')}
   validateSupplierAccess(data.supplierId,data.code,env);
   const page=data.page===undefined?1:Number(data.page);
   if(!Number.isSafeInteger(page)||page<1||page>10000)fail('Неверная страница',400);
   const {backup}=await github(env);
   return response(supplierOverview(backup,data.supplierId,page),200,origin);
  }
  if(u.pathname==='/submit'&&request.method==='POST'){
   if(origin!==ORIGIN)fail('Этот сервер принимает накладные только с сайта LANDA',403);
   if((request.headers.get('Content-Type')||'').split(';')[0]!=='application/json')fail('Ожидается application/json');
   const result=await submit(request,env);
   return response(result,result.duplicate?409:201,origin);
  }
  return response({error:'Не найдено'},404,origin);
 }catch(e){return response({error:e.message},e.code||500,origin)}
}};
export const __test={normalizeInvoice,submit,github};
