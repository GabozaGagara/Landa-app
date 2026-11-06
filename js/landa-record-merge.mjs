// Strict three-way reconciliation of independent edits to stable-ID records.
// Equal values or edits on only one side are safe; conflicting changes to the
// same scalar/unknown array must always be reviewed by a person.
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

export function mergeRecords(base,local,remote,{arrayIds={}}={}){
 const conflicts=[];
 function byId(rows,key,path){
  const result=new Map();
  for(const row of rows){
   const id=row&&typeof row==='object'?row[key]:null;
   if((typeof id!=='string'&&typeof id!=='number')||String(id)===''||result.has(String(id))){
    conflicts.push(path+' (некорректные или повторяющиеся ID)');return null;
   }
   result.set(String(id),row);
  }
  return result;
 }
 function walk(b,l,r,path){
  if(equal(l,r))return clone(l);
  if(equal(l,b))return clone(r);
  if(equal(r,b))return clone(l);
  if(plain(l)&&plain(r)&&(plain(b)||b===undefined)){
   const output={};
   for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){
    const value=walk(b&&own(b,key)?b[key]:undefined,
     own(l,key)?l[key]:undefined,own(r,key)?r[key]:undefined,path?path+'.'+key:key);
    if(value!==undefined)output[key]=value;
   }
   return output;
  }
  if(Array.isArray(l)&&Array.isArray(r)&&(Array.isArray(b)||b===undefined)){
   const idField=arrayIds[path];
   if(idField){
    const bm=byId(b||[],idField,path),lm=byId(l,idField,path),rm=byId(r,idField,path);
    if(!bm||!lm||!rm)return undefined;
    const ordered=[...new Set([...bm.keys(),...rm.keys(),...lm.keys()])],output=[];
    for(const id of ordered){
     const bv=bm.get(id),lv=lm.get(id),rv=rm.get(id);
     // Different objects created independently under the same ID are unsafe.
     if(bv===undefined&&lv!==undefined&&rv!==undefined&&!equal(lv,rv)){
      conflicts.push(path+'['+id+']');continue;
     }
     const value=walk(bv,lv,rv,path+'['+id+']');
     if(value!==undefined)output.push(value);
    }
    return output;
   }
  }
  conflicts.push(path||'корень');return undefined;
 }
 const merged=walk(base,local,remote,'');
 return {merged:conflicts.length?null:merged,conflicts};
}
