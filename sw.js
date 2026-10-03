// Hikâye Stüdyosu servis çalışanı: uygulamayı telefona kurulabilir yapar ve internetsiz açılmasını sağlar.
const APP = 'hikaye-studyosu-v7';      // uygulama dosyaları (her sürümde yenilenir)
const CDN = 'hikaye-studyosu-cdn-v1';  // dış kütüphaneler: ses motoru, yüz modeli, mp4 birleştirici, yazı tipleri (kalıcı)
const FILES = ['./', './index.html', './js/app.js', './js/senaryo.js', './js/zaman.js', './js/ses.js',
               './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'storage.googleapis.com'];

self.addEventListener('install', e => { e.waitUntil(caches.open(APP).then(c => c.addAll(FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== CDN).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request; if(req.method !== 'GET') return;
  const u = new URL(req.url);
  if(u.origin === location.origin){
    // uygulama dosyaları: önce internet (her zaman en yeni sürüm), internet yoksa önbellek
    e.respondWith(fetch(req).then(r => { if(r.ok){ const k = r.clone(); caches.open(APP).then(c => c.put(req, k)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch:true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  if(CDN_HOSTS.includes(u.hostname)){
    // sürümü sabit dış dosyalar: önce önbellek, yoksa internetten alıp sakla
    e.respondWith(caches.open(CDN).then(async c => {
      const hit = await c.match(req); if(hit) return hit;
      try{
        const r = await fetch(req);
        if((r.ok || r.type === 'opaque') && !u.search.includes('y=')) c.put(req, r.clone());
        return r;
      }catch(err){ const alt = await c.match(req, { ignoreSearch:true }); if(alt) return alt; throw err; }
    }));
  }
  // diğer dış istekler (ses modeli dosyaları) olduğu gibi geçer; ses motoru onları kendi saklar
});
