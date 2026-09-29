// Service worker: makes the app installable and keeps "Show QR" working with
// no signal (a loft, a basement, a rural job). Bump VERSION to refresh caches.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const PAGES = `pages-${VERSION}`;

const PRECACHE = ['/offline.html', '/css/app.css', '/js/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

// Logged-in pages worth having offline: the dashboard and the QR screen.
const OFFLINE_PAGES = ['/app', '/app/show'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, PAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Customer review pages must always hit the server (visit counting, and the
  // latest Google link). Downloads are generated fresh too.
  if (url.pathname.startsWith('/r/') || url.pathname.startsWith('/app/files/') || url.pathname.startsWith('/stripe')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected && OFFLINE_PAGES.includes(url.pathname)) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(url.pathname, copy));
          }
          // Seeing the login page means nobody is logged in: forget private pages.
          if (url.pathname === '/login' && res.ok && !res.redirected) caches.delete(PAGES);
          return res;
        })
        .catch(() =>
          caches.match(url.pathname, { cacheName: PAGES }).then((hit) => hit || caches.match('/offline.html')),
        ),
    );
    return;
  }

  // Static files and logos: serve from cache, refresh in the background.
  // Offline with a newer ?v= than we cached? Fall back to the older copy.
  if (/^\/(css|js|icons|u)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.open(SHELL).then((cache) =>
        cache.match(req).then((hit) => {
          const network = fetch(req)
            .then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => hit || cache.match(req, { ignoreSearch: true }));
          return hit || network;
        }),
      ),
    );
  }
});
