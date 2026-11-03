const CACHE_NAME = 'rodando-utp-v11';
const APP_SHELL = [
  './',
  './index.html',
  './login.html',
  './css/styles.css',
  './css/mapa-ia.css',
  './css/auth.css',
  './js/app.js?v=2',
  './js/sesion.js?v=2',
  './js/auth.js?v=2',
  './js/mapa-ia.js?v=2',
  './vendor/leaflet/leaflet.js?v=2',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './manifest.webmanifest',
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
        keys.filter((key) => key.startsWith('rodando-utp-') && key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  // La API SIEMPRE va a la red: cachear respuestas de /api/ devolveria
  // datos de sesion obsoletos y romperia el login y el panel de admin.
  // En GitHub Pages el path es /RodandoUTP/api/..., no /api/..., por eso
  // se comprueba si la URL contiene /api/ en cualquier parte.
  if (event.request.url.includes('/api/')) return;

  // El panel de administrador nunca se sirve desde la cache.
  if (new URL(event.request.url).pathname.startsWith('/admin')) return;

  // Los mosaicos de OpenStreetMap se piden siempre a la red: cachearlos
  // en masa incumpliria la politica de uso de OSM. Si no hay conexion,
  // Leaflet muestra el fondo y las zonas siguen visibles.
  if (event.request.url.includes('tile.openstreetmap.org')) return;

  // Navegaciones primero en red para recibir cambios; app shell disponible offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match(event.request)) || (await caches.match('./index.html'))));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
