// LANDA app shell: static public code only, never private financial data.
// Allows an already-opened device to reopen its interface when GitHub Pages
// is temporarily unreachable. Cloud synchronization remains a separate check.
const CACHE_NAME = 'landa-public-shell-v1-20261125';
const PUBLIC_FILES = [
  'index.html',
  'js/landa-aux-sync-core.mjs',
  'js/landa-aux-sync.mjs',
  'js/landa-cb-baseline.mjs',
  'js/landa-control-center.js',
  'js/landa-expenses-core.mjs',
  'js/landa-expenses-ui.mjs',
  'js/landa-finance-sync-core.mjs',
  'js/landa-local-backups.js',
  'js/landa-moysklad-match.mjs',
  'js/landa-moysklad-ui.mjs',
  'js/landa-pallet-core.mjs',
  'js/landa-pallet-settlement.mjs',
  'js/landa-pallet-stock.mjs',
  'js/landa-pallet-ui.mjs',
  'js/landa-receiving-core.mjs',
  'js/landa-receiving-ui.mjs',
  'js/landa-record-merge.mjs'
];
const fileSet = new Set(PUBLIC_FILES);
const scope = self.registration.scope;
const toURL = file => new URL(file, scope).href;
const rootPath = new URL(scope).pathname;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PUBLIC_FILES.map(toURL));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('landa-public-shell-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
async function notifyOffline(){
  const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients) client.postMessage({type:'LANDA_STATIC_FALLBACK'});
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin !== self.location.origin || !url.pathname.startsWith(rootPath))return;
  const filename = url.pathname.slice(rootPath.length) || 'index.html';
  if(!fileSet.has(filename))return; // Never cache GitHub API, tokens or private backups.
  const key = toURL(filename);
  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try{
      const response = await fetch(request, {signal:controller.signal});
      if(response.ok && response.type === 'basic'){
        const cache = await caches.open(CACHE_NAME);
        event.waitUntil(cache.put(key, response.clone()));
      }
      return response;
    }catch(error){
      const cache = await caches.open(CACHE_NAME);
      const saved = await cache.match(key);
      if(saved){
        event.waitUntil(notifyOffline());
        return saved;
      }
      throw error;
    }finally{clearTimeout(timeout)}
  })());
});
