const CACHE='exhibition-offline-v28-notes';
const FILES=['./ExhibitionMemo_v23.html','./offline-drive.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin || event.request.method!=='GET')return;
 const match=FILES.find(file=>new URL(file,self.registration.scope).pathname===url.pathname);
 if(!match)return;
 event.respondWith(fetch(event.request).then(response=>{
   if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(match,copy)));}
   return response;
 }).catch(()=>caches.open(CACHE).then(cache=>cache.match(match))));
});
