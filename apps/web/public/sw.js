/*
 * DocCheck service worker: makes the app installable and lets its shell open offline.
 *
 * It caches STATIC files only, chosen by an allow-list of same-origin GET requests:
 *   - the app shell: navigations to / (or /index.html), network first, the cached copy when offline;
 *   - /assets/* (Vite's content-hashed bundles) and /icons/*: cache first, they never change in place;
 *   - /manifest.webmanifest: network first.
 * Everything else goes straight to the network, untouched: API calls and event streams (/auth,
 * /shipments, /events, /admin, …), documents and PDFs, other origins, and any request that is not a
 * GET. Responses are stored only when they are a plain 200 from this origin and not a PDF, so shipment
 * data and uploaded documents never end up in the cache.
 *
 * Bump VERSION to drop everything cached by an earlier worker (old caches are deleted on activate).
 */
const VERSION = 'v1';
const CACHE = `doccheck-static-${VERSION}`;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([new Request(SHELL, { cache: 'reload' }), new Request('/manifest.webmanifest', { cache: 'reload' })]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('doccheck-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (request.mode === 'navigate') {
    // The app routes in the hash, so its only page is /; other navigations (a PDF opened in a tab) pass.
    if (path === '/' || path === '/index.html') event.respondWith(networkFirst(request, SHELL));
    return;
  }
  if (path.startsWith('/assets/') || path.startsWith('/icons/')) event.respondWith(cacheFirst(request));
  else if (path === '/manifest.webmanifest') event.respondWith(networkFirst(request, path));
});

function cacheable(response) {
  return response.ok && response.status === 200 && response.type === 'basic' && !(response.headers.get('content-type') || '').includes('pdf');
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}
