const CACHE_NAME = 'rodando-utp-v2';
const APP_SHELL = [
  './',
  './index.html',
  './login.html',
  './css/styles.css',
  './css/mapa-ia.css',
  './css/auth.css',
  './js/app.js',
  './js/sesion.js',
  './js/auth.js',
  './js/mapa-ia.js',
  './manifest.webmanifest',
  './data/rutas.json',
  './img/hero-carpool.svg',
  './img/utp-route.svg',
  './img/icon-192.png',
  './img/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // La API SIEMPRE va a la red: cachear respuestas de /api/ devolveria
  // datos de sesion obsoletos y romperia el login y el panel de admin.
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;

  // El panel de administrador nunca se sirve desde la cache.
  if (new URL(event.request.url).pathname.startsWith('/admin')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith(self.location.origin)) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });

      return cachedResponse || networkFetch.catch(() => caches.match('./index.html'));
    })
  );
});
