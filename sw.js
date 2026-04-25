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
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
