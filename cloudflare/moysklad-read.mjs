// Read-only MoySklad bridge. Never accesses LANDA financial backup or writes MoySklad documents.
const API='https://api.moysklad.ru/api/remap/1.2/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=new Set(['product','variant','bundle','service','consignment']);
function fail(message,code=502){const e=new Error(message);e.code=code;throw e;}
function dateOnly(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('Неверная дата запроса',400);
 return s;
}
export function validateRange(from,to){
 const start=dateOnly(from),end=dateOnly(to),days=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
 if(days<0||days>31)fail('Выберите период от 1 до 32 календарных дней',400);
 return {from:start,to:end};
}
export function assortmentRef(ref){
 const href=ref?.meta?.href||'';
 const m=/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/([a-z]+)\/([a-f0-9-]{36})(?:\?.*)?$/i.exec(href);
 if(!m||!TYPES.has(m[1])||!UUID.test(m[2]))return null;
 return {type:m[1],id:m[2]};
}
async function msGet(path,env){
 const token=env.MOYSKLAD_TOKEN;
 if(typeof token!=='string'||!token.trim())fail('Секрет MOYSKLAD_TOKEN не настроен в Cloudflare',503);
 // Paths are always constructed locally from whitelisted entity names and UUIDs.
 const url=new URL(path,API);
 if(url.origin!=='https://api.moysklad.ru'||!url.pathname.startsWith('/api/remap/1.2/'))fail('Недопустимый путь API',400);
 let res;
 try{res=await fetch(url.toString(),{method:'GET',headers:{Authorization:'Bearer '+token.trim(),Accept:'application/json'},redirect:'error'});}
 catch(_){fail('Нет соединения с API МойСклад');}
 if(!res.ok){
  if(res.status===401||res.status===403)fail('МойСклад отклонил доступ. Проверьте токен и права чтения.',502);
  if(res.status===429)fail('МойСклад ограничил количество запросов. Повторите позднее.',503);
  fail('МойСклад вернул HTTP '+res.status);
 }
 try{return await res.json()}catch(_){fail('МойСклад вернул некорректный JSON')}
}
function short(x,n=180){return String(x??'').slice(0,n)}
export async function loadSupplies(env,from,to){
 ({from,to}=validateRange(from,to));
 const docs=[];
 const filter='moment>='+from+' 00:00:00;moment<='+to+' 23:59:59;applicable=true';
 for(let offset=0;offset<500;offset+=100){
  const params=new URLSearchParams({filter,limit:'100',offset:String(offset),expand:'agent,store'});
  const page=await msGet('entity/supply?'+params,env);
  if(!Array.isArray(page.rows))fail('МойСклад не прислал список приёмок');
  docs.push(...page.rows);
  if(docs.length>500)fail('Найдено более 500 приёмок. Уменьшите период.',422);
  if(!page.meta?.nextHref)break;
  if(offset===400)fail('Слишком много приёмок за период. Уменьшите диапазон.',422);
 }
 const memo=new Map(),result=[];
 for(const doc of docs){
  if(!UUID.test(String(doc.id||'')))continue;
  if(doc.applicable===false)continue;
  const positions=[];
  for(let offset=0;offset<2000;offset+=1000){
   const page=await msGet('entity/supply/'+doc.id+'/positions?'+new URLSearchParams({limit:'1000',offset:String(offset),expand:'assortment'}),env);
   if(!Array.isArray(page.rows))fail('Не удалось прочитать товары приёмки '+short(doc.name,60));
   for(const p of page.rows){
    const ref=assortmentRef(p.assortment);
    if(!ref)fail('В приёмке '+short(doc.name,60)+' обнаружен товар без поддерживаемой ссылки. Сверка неполная.');
    const key=ref.type+':'+ref.id;
    let product=p.assortment;
    if(!product?.name){
     if(!memo.has(key)){
      if(memo.size>=700)fail('Слишком много разных товаров. Уменьшите период.',422);
      memo.set(key,await msGet('entity/'+ref.type+'/'+ref.id,env));
     }
     product=memo.get(key);
    }
    const quantity=Number(p.quantity);
    if(!product?.name||!Number.isFinite(quantity)||quantity<0)fail('В приёмке '+short(doc.name,60)+' обнаружен товар с неуказанным названием или количеством.');
    positions.push({id:short(p.id,50),productId:key,name:short(product.name,200),
     sku:short(product?.article||product?.code||'',100),article:short(product?.article||'',100),
     code:short(product?.code||'',100),quantity});
   }
   if(!page.meta?.nextHref)break;
   if(offset===1000)fail('В одной приёмке слишком много товарных строк.',422);
  }
  result.push({id:doc.id,name:short(doc.name,100),date:short(doc.moment,10),
   agent:short(doc.agent?.name||'',100),store:short(doc.store?.name||'',100),applicable:doc.applicable!==false,positions});
 }
 return {from,to,documents:result,loadedAt:new Date().toISOString(),source:'MoySklad JSON API 1.2',mode:'read-only'};
}
// Connection check returns no supplier data and never modifies documents.
export async function checkConnection(env){
 const result=await msGet('entity/supply?limit=1',env);
 if(!Array.isArray(result?.rows))fail('API МойСклад не вернул корректный список приёмок');
 return {ok:true,service:'МойСклад',access:'read-only',checkedAt:new Date().toISOString()};
}
export const __test={dateOnly,assortmentRef};
