const CACHE_NAME = 'marker-v3';
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const NETWORK_FIRST = ['index.html', 'app.js', './'];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }
  const isNetworkFirst = NETWORK_FIRST.some(p => url.pathname.endsWith(p) || url.pathname === '/');
  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
