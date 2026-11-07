import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Source-only regression tests. They never read or write the private finance backup.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('cash, supplier and payment ledger saves mark cloud sync urgent',()=>{
 const saveOps=html.match(/function saveOps\(\)\{[\s\S]*?\nfunction opCommit/)?.[0];
 assert.ok(saveOps,'saveOps must be present');
 assert.match(saveOps,/new CustomEvent\('landa:data-changed',\{detail:\{urgent:true\}\}\)/);
 assert.match(saveOps,/localStorage\.setItem\(OPS_KEY,data\)/);
});

test('urgent ledger uploads are queued promptly, without replacing other values',()=>{
 assert.match(html,/function queueUpload\(delay=3200\)/);
 assert.match(html,/event\?\.detail\?\.urgent\?150:3200/);
 assert.match(html,/timer=setTimeout\(\(\)=>upload\(false\),delay\)/);
 assert.match(html,/setMeta\(newSha,localHash\)/);
});

test('offline save is visibly distinguished from cloud success',()=>{
 assert.match(html,/Сохранено только на устройстве/);
 assert.match(html,/GitHub: все изменения сохранены/);
 assert.match(html,/if\(conf\.auto&&configReady\(\)\)setTimeout/);
});

test('full local backup contains finance operations as well as the estimate',()=>{
 assert.match(html,/downloadBackup=function\(\)\{download\(JSON\.stringify\(\{app:'LANDA-suite',backupVersion:3/);
 assert.match(html,/proschet:state,operations:ops/);
});
