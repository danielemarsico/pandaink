// PandaInk service worker — makes the web app installable (PWA) and caches the
// static app shell for faster loads and basic offline availability.
//
// Scope: this file is served at <site>/pandaink/sw.js, so its scope is
// /pandaink/ — it covers app.html and every module it imports.
//
// Design rules:
//   • Only same-origin GET requests are touched. Cross-origin calls (Supabase
//     auth/DB, Google Drive, Dropbox, the Cloudflare Worker, the jsDelivr CDN)
//     always go straight to the network — the SW never caches or blocks them.
//   • Navigations use network-first (so a new deploy shows up immediately, with
//     the cached shell as an offline fallback).
//   • Other static assets (JS/CSS/icons) use stale-while-revalidate: the cached
//     copy is served immediately (instant repeat loads) while a fresh copy is
//     fetched in the background for the NEXT load. Plain cache-first pinned
//     every visitor to the modules cached on their first visit — a deploy fixing
//     a bug in docs/ui/*.js never reached them.
//   • version.json is always fetched fresh so the build stamp stays accurate.
//
// Bump CACHE on any release that must invalidate what visitors already hold;
// `activate` deletes every cache whose name doesn't match.

const CACHE = 'pandaink-shell-v2';

// Minimal shell guaranteed to be available offline after first visit. The rest
// of the modules are cached lazily as they're fetched.
const CORE = ['./app.html', './style.css', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cachePut(request, response) {
  // Only cache complete, OK, basic (same-origin) responses.
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Leave cross-origin traffic (Supabase, Google, Dropbox, Worker, CDN) alone.
  if (url.origin !== self.location.origin) return;

  // Always fetch the build stamp fresh (fall back to cache only when offline).
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Navigations: network-first so new deploys win; cached shell as fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => cachePut(req, res))
        .catch(async () => (await caches.match(req)) || caches.match('./app.html'))
    );
    return;
  }

  // Other static assets: stale-while-revalidate — serve the cached copy at once
  // and refresh it in the background so the next load picks up a new deploy.
  event.respondWith((async () => {
    const cached  = await caches.match(req);
    const network = fetch(req).then((res) => cachePut(req, res));
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })());
});
