/* North service worker: shows decision-card pushes and opens the card on tap (DEC-2). */

/*
 * PWA-1 (M6): the worker also keeps three things for offline use and nothing
 * else. `north-static-v1`: `/_next/static/*` chunks (cache-first when the
 * server marked them immutable, else network-first with the cached copy as
 * the fallback) and the `/offline` page with the chunks it references.
 * `north-brief-v1`: the latest brief per company, written only when a page
 * posts `{ type: "brief" }` and read only by `/offline`. Navigations go to
 * the network and fall back to `/offline`; they are never cached, and no
 * API response, card or other request is ever stored or served from cache.
 */
const STATIC_CACHE = "north-static-v1";
const BRIEF_CACHE = "north-brief-v1";
const OFFLINE_URL = "/offline";
const STATIC_PREFIX = "/_next/static/";
const STATIC_MAX_ENTRIES = 400;
const BRIEF_MAX_BYTES = 64 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ASSET_RE = /\/_next\/static\/[^"'\s\\)<>]+/g;

/** The offline page and every static asset its HTML names; best effort, so a failure never blocks the push worker from installing. */
async function precacheOffline() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const response = await fetch(OFFLINE_URL, { credentials: "omit", cache: "no-store" });
    if (!response.ok) return;
    const html = await response.text();
    await cache.put(OFFLINE_URL, new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
    const assets = [...new Set(html.match(ASSET_RE) || [])];
    await Promise.all(assets.map((path) => cache.add(path).catch(() => undefined)));
  } catch {
    // Offline support is an extra; push keeps working without it.
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precacheOffline());
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("north-") && key !== STATIC_CACHE && key !== BRIEF_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("push", (event) => {
  let data = { title: "North", body: "A decision is waiting.", url: "/companies" };
  try {
    data = { ...data, ...(event.data ? event.data.json() : {}) };
  } catch {
    // A non-JSON payload keeps the defaults.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
      icon: "/favicon.ico",
      tag: data.url,
      renotify: true,
    }),
  );
});

/** Only this origin may be opened from a notification, whatever the payload says. */
function sameOriginUrl(candidate) {
  try {
    const url = new URL(candidate, self.location.origin);
    return url.origin === self.location.origin ? url.href : `${self.location.origin}/companies`;
  } catch {
    return `${self.location.origin}/companies`;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOriginUrl((event.notification.data && event.notification.data.url) || "/companies");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => "focus" in c);
      if (open) {
        open.navigate(url);
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

const isImmutable = (response) => /\bimmutable\b/.test(response.headers.get("Cache-Control") || "");

async function trimStatic(cache) {
  const keys = await cache.keys();
  const excess = keys.filter((request) => new URL(request.url).pathname !== OFFLINE_URL).slice(0, Math.max(0, keys.length - STATIC_MAX_ENTRIES));
  await Promise.all(excess.map((request) => cache.delete(request)));
}

/** Immutable chunks from cache first; anything else from the network, keeping a copy for when the network is gone. */
async function staticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit && isImmutable(hit)) return hit;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      await trimStatic(cache);
    }
    return response;
  } catch (error) {
    if (hit) return hit;
    throw error;
  }
}

/** Network first; only when the network fails, the precached offline page. The navigation itself is never stored. */
async function navigation(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_URL, { cacheName: STATIC_CACHE });
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(staticAsset(request));
    return;
  }
  if (request.mode === "navigate") event.respondWith(navigation(request));
  // Everything else (API routes, RSC payloads, server actions, images) passes through untouched.
});

/** `{ type: "brief", slug, brief }` from a page of this origin: the latest brief of that company, replacing the previous one. */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "brief") return;
  if (event.origin && event.origin !== self.location.origin) return;
  if (typeof data.slug !== "string" || !SLUG_RE.test(data.slug) || typeof data.brief !== "object" || data.brief === null) return;
  const body = JSON.stringify({ slug: data.slug, brief: data.brief, cachedAt: new Date().toISOString() });
  if (body.length > BRIEF_MAX_BYTES) return;
  event.waitUntil(
    caches.open(BRIEF_CACHE).then((cache) => cache.put(`/brief/${data.slug}`, new Response(body, { headers: { "Content-Type": "application/json" } }))),
  );
});
