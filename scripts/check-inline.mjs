import {readFileSync,existsSync} from 'node:fs';
import {Script} from 'node:vm';
for (const file of ['index.html','supplier.html']){
 const text=readFileSync(file,'utf8');
 const tags=[...text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 let checked=0;
 for(const match of tags){
  const opening=match[0].slice(0,match[0].indexOf('>')+1);
  if(/\bsrc\s*=/.test(opening))continue;
  if(/\btype\s*=\s*["']application\/json/.test(opening))continue;
  const js=match[1];
  if(!js.trim())continue;
  new Script(js,{filename:file+'#inline-'+(++checked)});
 }
 if(!text.includes('</html>'))throw Error(file+' ends without </html>');
 if(file==='index.html'){
  for(const path of ['js/landa-control-center.js','js/landa-local-backups.js'])
   if(!existsSync(path))throw Error('Missing '+path);
 }
 if(file==='supplier.html'&&!text.includes('loadSupplierOverview'))throw Error('Supplier viewer is incomplete');
 console.log(file+': syntax OK, '+checked+' inline scripts');
}
