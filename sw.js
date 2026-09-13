'use strict';

const CACHE_NAME = 'workout-tracker-v65';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './models.js',
  './repository.js',
  './i18n.js',
  './exercises.js',
  './workout.js',
  './stats.js',
  './devtools.js',
  './backup.js',
  './plans.js',
  './calendar.js',
  './changelog.js',
  './updates.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './sample-data/full-backup-sample.json',
];

self.addEventListener('install', (event) => {
  // Deliberately no self.skipWaiting() here anymore — a freshly-installed
  // worker now waits until the page explicitly tells it it's safe to take
  // over (see the 'message' listener below), so it never interrupts an
  // active draft workout mid-session. See updates.js for the page-side
  // half of this handshake.
  //
  // Deliberately NOT cache.addAll(APP_SHELL), and not even a plain
  // fetch(url, { cache: 'reload' }) — both were tried and both still let
  // stale content through in practice. `cache: 'reload'` only bypasses the
  // *browser's own* local HTTP cache; it does nothing to a CDN edge cache
  // in between (GitHub Pages' Fastly CDN can still serve its own cached
  // response regardless of what cache directive the request carries), and
  // sw.js itself is the only file browsers unconditionally re-fetch past
  // every cache layer when checking for updates — which is exactly how
  // this hid twice: CACHE_NAME correctly read as the new version while
  // some other precached file (exercises.js, then updates.js) was still
  // silently serving old content underneath.
  //
  // NOTE: this query-string buster defeats the *browser's* own HTTP cache,
  // but NOT GitHub Pages' CDN (Fastly) — confirmed via curl that Fastly
  // computes its cache key from the path only and ignores the query
  // string, and every response also carries a flat 10-minute
  // (max-age=600) edge TTL we can't configure away. So for up to ~10
  // minutes after a push, this fetch can still return a stale CDN
  // response no matter what query string is attached. See
  // ARCHITECTURE.md's "Precaching gotcha" section for the full story —
  // kept here anyway because it's still a real (partial) improvement, just
  // not the CDN fix it looks like. Fetched under the busted URL, but
  // stored in Cache Storage under the plain path — the 'fetch' handler
  // below matches incoming requests by their plain (non-busted) URL, so
  // this is invisible to every other caller.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) => {
          const bustedUrl = `${url}${url.includes('?') ? '&' : '?'}swv=${encodeURIComponent(CACHE_NAME)}`;
          return fetch(bustedUrl, { cache: 'reload' }).then((response) => cache.put(url, response));
        })
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll())
      .then((clients) => {
        // Tell every open tab which version just took over — updates.js
        // uses this to detect a genuine version transition (vs. a fresh
        // install) and show the "what's new" popup at most once per
        // transition.
        clients.forEach((client) => client.postMessage({ type: 'ACTIVATED', version: CACHE_NAME }));
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return undefined;
        });
    })
  );
});
