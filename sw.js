'use strict';

const CACHE_NAME = 'workout-tracker-v58';
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
  // Deliberately NOT cache.addAll(APP_SHELL) — that fetches each URL with
  // normal HTTP caching rules, which means it can silently pull a STALE
  // copy straight from the browser's own HTTP cache instead of the real
  // current file, even on a genuinely new install. (sw.js itself is exempt
  // from this — browsers always re-fetch the worker script itself bypassing
  // cache — which is exactly how this bug hid: CACHE_NAME correctly read
  // as the new version while other precached files were silently stale.)
  // `cache: 'reload'` forces every one of these fetches to hit the network
  // for real, matching what the browser already guarantees for sw.js
  // itself.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => fetch(url, { cache: 'reload' }).then((response) => cache.put(url, response))))
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
