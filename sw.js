// Ortho service worker — app shell cache + web push
const CACHE = 'ortho-v13';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/config.js', '/guide-content.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Supabase/API traffic: hamesha network, kabhi cache nahi
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'Ortho 🌿';
  const options = {
    body: data.body || 'Subah ho gayi Ahmad 🌤️ Naak kaisi hai aaj? 2 minute me check-in kar lo — Ortho',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'ortho-morning-checkin',
    data: { url: data.url || '/?tab=chat' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/?tab=chat';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate(target); return w.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
