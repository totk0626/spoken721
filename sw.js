const CACHE = 'spoken721-v4';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'words.js',
  'manifest.webmanifest',
  'fonts/PretendardVariable.woff2',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Cache first so the app opens offline; refresh in the background so the next launch gets updated files.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const key = request.mode === 'navigate' ? 'index.html' : request;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(request).then(response => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
    if (!cached) return fresh;
    event.waitUntil(fresh.catch(() => {}));
    return cached;
  }));
});
