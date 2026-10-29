// Pure product matching and quantity reconciliation; never changes financial records.
export const normalizeName=s=>String(s??'').toLocaleLowerCase('ru-RU')
 .replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim().replace(/\s+/g,' ');
const words=s=>new Set(normalizeName(s).split(' ').filter(Boolean));
export const productLinkKey=(supplierId,name,sku)=>JSON.stringify([String(supplierId),normalizeName(sku),normalizeName(name)]);
function similarity(a,b){
 const x=normalizeName(a),y=normalizeName(b);
 if(!x||!y)return 0;
 if(x===y)return 1;
 const wx=words(x),wy=words(y),common=[...wx].filter(w=>wy.has(w)).length;
 return common/Math.max(wx.size,wy.size);
}
export function candidates(line,products,knownId=''){
 const found=products.map(product=>{
  const sameSku=!!normalizeName(line.sku)&&normalizeName(line.sku)===normalizeName(product.sku||product.article||product.code);
  const nameScore=similarity(line.name,product.name);
  const stored=knownId&&knownId===product.id;
  const collision=!!normalizeName(line.sku)&&!!normalizeName(product.sku)&&!sameSku;
  const score=stored?130:sameSku&&nameScore>=.5?110:!collision&&nameScore===1?100:sameSku?88:collision?0:Math.round(nameScore*75);
  return {...product,score,method:stored?'manual':sameSku?'sku':nameScore===1?'name':'similar'};
 }).filter(p=>p.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ru'));
 const best=found[0],second=found[1];
 const automatic=!!best&&(best.method==='manual'||(best.score>=100&&(!second||best.score-second.score>=15)));
 return {best,automatic,suggestions:found.slice(0,12)};
}
export function collectDelivered(invoices,supplierId,to){
 const rows=[];
 for(const invoice of invoices||[]){
  if(!invoice||invoice.isOpening||invoice.supplierId!==supplierId)continue;
  if(!['delivered','received'].includes(invoice.status))continue;
  if(String(invoice.date||'').slice(0,10)>to)continue;
  for(const [index,item] of (invoice.items||[]).entries()){
   if(!item?.name||!Number.isFinite(Number(item.qty))||Number(item.qty)<=0)continue;
   rows.push({invoiceId:String(invoice.id),invoiceNumber:String(invoice.number||invoice.tracking||invoice.id),
    date:String(invoice.date||'').slice(0,10),tracking:String(invoice.tracking||''),
    index,name:String(item.name).trim(),sku:String(item.sku||'').trim(),qty:Number(item.qty)});
  }
 }
 return rows;
}
export function aggregateLines(rows){
 const groups=new Map();
 for(const r of rows){
  const key=productLinkKey('selected',r.name,r.sku);
  if(!groups.has(key))groups.set(key,{key,name:r.name,sku:r.sku,expected:0,invoices:new Set()});
  const g=groups.get(key);g.expected+=r.qty;g.invoices.add(r.invoiceNumber);
 }
 return [...groups.values()].map(x=>({...x,invoices:[...x.invoices]}));
}
export function receivedByProduct(docs){
 const map=new Map();
 for(const d of docs)for(const p of d.positions||[]){
  if(!p.productId||!Number.isFinite(Number(p.quantity)))continue;
  map.set(p.productId,(map.get(p.productId)||0)+Number(p.quantity));
 }
 return map;
}
export function compareSelected(rows,docs,links={},supplierId=''){
 const products=new Map(),actual=receivedByProduct(docs);
 for(const d of docs)for(const p of d.positions||[])if(p.productId&&!products.has(p.productId)){
  products.set(p.productId,{id:p.productId,name:p.name,sku:p.sku,article:p.article,code:p.code});
 }
 const results=aggregateLines(rows).map(g=>{
  const linked=links[productLinkKey(supplierId,g.name,g.sku)]||'';
  const choice=candidates(g,[...products.values()],linked);
  const selected=choice.automatic?choice.best:null;
  const received=selected?actual.get(selected.id)||0:null;
  const delta=received===null?null:Math.round((received-g.expected)*10000)/10000;
  return {...g,match:selected,candidate:choice.best||null,automatic:choice.automatic,received,delta,
   state:!selected?'unmatched':Math.abs(delta)<.000001?'matched':'difference'};
 });
 // A single MoySklad product matched against multiple LANDA names must be compared once.
 const matches=new Map();
 for(const r of results)if(r.match){
  if(!matches.has(r.match.id))matches.set(r.match.id,[]);
  matches.get(r.match.id).push(r);
 }
 for(const [id,groups] of matches)if(groups.length>1){
  const total=groups.reduce((s,r)=>s+r.expected,0);
  const difference=Math.round(((actual.get(id)||0)-total)*10000)/10000;
  for(const g of groups){g.received=null;g.delta=null;g.state='shared';g.sharedExpected=total;g.sharedDifference=difference;}
 }
 const unmatchedProducts=[...products.values()].filter(p=>!matches.has(p.id)&&actual.get(p.id)>0).map(p=>({...p,received:actual.get(p.id)}));
 return {results,unmatchedProducts,products:[...products.values()]};
}
