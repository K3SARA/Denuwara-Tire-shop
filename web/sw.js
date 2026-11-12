const CACHE_NAME = 'cashew-billing-v135';
const ASSETS = [
  './',
  './index.html',
  './receipt-print.html',
  './manifest.json?v=135',
  './css/variables.css?v=135',
  './css/base.css?v=135',
  './css/components.css?v=135',
  './css/pages.css?v=135',
  './fonts/SamsungOne-400.woff2',
  './fonts/SamsungOne-700.woff2',
  './vendor/leaflet/leaflet.css?v=135',
  './vendor/leaflet/leaflet.js?v=135',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './js/deploy-config.js?v=135',
  './js/supabase-config.js?v=135',
  './js/db.js?v=135',
  './js/auth.js?v=135',
  './js/app.js?v=135',
  './js/billing.js?v=135',
  './js/history.js?v=135',
  './js/customers.js?v=135',
  './js/suppliers.js?v=135',
  './js/collection.js?v=135',
  './js/expenses.js?v=135',
  './js/pdf.js?v=135',
  './js/reports.js?v=135',
  './js/inventory.js?v=135',
  './js/share.js?v=135',
  './js/receipt-print.js?v=135',
  './js/clear-inputs.js?v=132',
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
          if (res && res.ok) {
            try {
              const copy = res.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(e.request, copy))
                .catch(() => {});
            } catch (err) {}
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
            if (res && res.ok) {
              try {
                const copy = res.clone();
                cache.put(e.request, copy).catch(() => {});
              } catch (err) {}
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
          if (res && res.ok) {
            try {
              const copy = res.clone();
              cache.put(e.request, copy).catch(() => {});
            } catch (err) {}
          }
          return res;
        }).catch(() => new Response('', { status: 504, statusText: 'Offline' }));
      });
    })
  );
});





















