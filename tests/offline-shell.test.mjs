import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const files=Function(sw.match(/const PUBLIC_FILES = (\[[\s\S]*?\]);/)?.[1]&&'return '+sw.match(/const PUBLIC_FILES = (\[[\s\S]*?\]);/)[1])();

test('offline shell has no private data sources or remote API caching',()=>{
 assert.ok(Array.isArray(files));
 assert.ok(files.includes('index.html'));
 assert.ok(files.every(x=>x==='index.html'||/^js\/[a-z0-9-]+\.(mjs|js)$/.test(x)));
 assert.ok(files.every(x=>!x.includes('backup')||x==='js/landa-local-backups.js'));
 assert.match(sw,/url\.origin !== self\.location\.origin/);
 assert.match(sw,/if\(!fileSet\.has\(filename\)\)return/);
 assert.match(sw,/if\(request\.method !== 'GET'\) return/);
});

test('all JavaScript modules required by the app are precached',()=>{
 const expected=readdirSync(new URL('../js/',import.meta.url)).filter(x=>/\.(mjs|js)$/.test(x)).map(x=>'js/'+x).sort();
 assert.deepEqual(files.filter(x=>x.startsWith('js/')).sort(),expected);
});

test('cache is populated once while online and only used as a network fallback',()=>{
 assert.match(sw,/await cache\.addAll\(PUBLIC_FILES\.map\(toURL\)\)/);
 assert.match(sw,/await fetch\(request, \{signal:controller\.signal\}\)/);
 assert.match(sw,/const saved = await cache\.match\(key\)/);
 assert.match(sw,/if\(saved\)/);
 assert.match(sw,/event\.waitUntil\(notifyOffline\(\)\)/);
 assert.match(sw,/const timeout = setTimeout\(\(\) => controller\.abort\(\), 4500\)/);
});

test('offline banner warns user that cloud financial data is not verified',()=>{
 assert.match(html,/navigator\.serviceWorker\.register\('\.\/sw\.js',\{scope:'\.\/'\}\)/);
 assert.match(html,/GitHub\. Перед финансовыми операциями проверь синхронизацию/);
 assert.match(html,/if\(event\.data&&event\.data\.type==='LANDA_STATIC_FALLBACK'\)warn\(\)/);
 assert.match(html,/method:'HEAD',cache:'no-store'/);
});

test('neither worker nor offline initialization changes financial operations',()=>{
 const i=html.indexOf('// Offline reopening support');
 assert.ok(i>=0);
 const last=html.slice(i);
 assert.doesNotMatch(last,/ops\.cash|ops\.payments|ops\.invoices|localStorage\.setItem|backup\.json/);
 assert.doesNotMatch(sw,/localStorage|sessionStorage/);
});
