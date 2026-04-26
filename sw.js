const CACHE_NAME = 'marker-v2';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'icon-512.png',
  'manifest.json',
  'lib/jszip.min.js',
  'lib/crypto-js.min.js',
  'lib/marked.min.js',
  'lib/html-docx.js',
  'lib/FileSaver.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Externe API-Requests nicht cachen, direkt durchleiten
  if (url.origin !== location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
