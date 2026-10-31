const CACHE_NAME = 'cashew-billing-v119';
const ASSETS = [
  './',
  './index.html',
  './receipt-print.html',
  './manifest.json?v=119',
  './css/variables.css?v=119',
  './css/base.css?v=119',
  './css/components.css?v=119',
  './css/pages.css?v=119',
  './fonts/SamsungOne-400.woff2',
  './fonts/SamsungOne-700.woff2',
  './vendor/leaflet/leaflet.css?v=119',
  './vendor/leaflet/leaflet.js?v=119',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './js/deploy-config.js?v=119',
  './js/supabase-config.js?v=119',
  './js/db.js?v=119',
  './js/auth.js?v=119',
  './js/app.js?v=119',
  './js/billing.js?v=119',
  './js/history.js?v=119',
  './js/customers.js?v=119',
  './js/collection.js?v=119',
  './js/expenses.js?v=119',
  './js/pdf.js?v=119',
  './js/reports.js?v=119',
  './js/inventory.js?v=119',
  './js/share.js?v=119',
  './js/receipt-print.js?v=119',
  './js/clear-inputs.js?v=119',
  './icons/logo-print.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // Skip missing/unreachable assets instead of failing SW install.
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // HTML navigation: network-first so users always get fresh HTML after updates.
  // Falls back to cached index.html when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() =>
          caches.open(CACHE_NAME).then((cache) =>
            cache.match(e.request) || cache.match('./index.html') || new Response('Offline', { status: 504 })
          )
        )
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate
  // Serve cached instantly, update cache in background for next load
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(e.request).then((cached) => {
          const fetchPromise = fetch(e.request).then((res) => {
            if (res.ok) {
              cache.put(e.request, res.clone());
            }
            return res;
          }).catch(() => null);

          if (cached) return cached;

          return fetchPromise.then((res) => {
            if (res) return res;
            if (e.request.destination === 'document') {
              return cache.match('./index.html') || new Response('Offline', { status: 504 });
            }
            return new Response('', { status: 504, statusText: 'Offline' });
          });
        });
      })
    );
    return;
  }

  // External resources (Google Fonts, etc): cache-first with network fallback
  // Ensures fonts are available offline after first successful load
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            cache.put(e.request, res.clone());
          }
          return res;
        }).catch(() => new Response('', { status: 504, statusText: 'Offline' }));
      });
    })
  );
});





















