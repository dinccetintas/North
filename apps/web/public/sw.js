/* North service worker: shows decision-card pushes and opens the card on tap (DEC-2). */

/*
 * PWA-1 (M6): the worker also keeps three things for offline use and nothing
 * else. `north-static-v1`: `/_next/static/*` chunks (cache-first when the
 * server marked them immutable, else network-first with the cached copy as
 * the fallback) and the `/offline` page with the chunks it references.
 * `north-brief-v1`: the latest brief per company of one user, at
 * `/brief/<userId>/<slug>`, written only when a page posts
 * `{ type: "brief", userId }` and read only by `/offline`, which shows the
 * user named at `/brief/last-user`. A brief from another user replaces the
 * previous user's; `{ type: "sign-out" }`, a navigation to `/login` and a
 * navigation the server redirects to `/login` delete the cache (M6 review
 * L14: nothing of an account stays for the next person on the device).
 * Navigations go to the network and fall back to `/offline`; they are never
 * cached, and no API response, card or other request is ever stored or
 * served from cache.
 */
const STATIC_CACHE = "north-static-v1";
const BRIEF_CACHE = "north-brief-v1";
const OFFLINE_URL = "/offline";
const STATIC_PREFIX = "/_next/static/";
const STATIC_MAX_ENTRIES = 400;
const BRIEF_MAX_BYTES = 64 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const USER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BRIEF_USER_KEY = "/brief/last-user";
const LOGIN_PATH = "/login";
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
      .then(() => inOrder(dropUnownedBriefs))
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

/* ---------- the brief cache: one user's briefs, cleared on sign-out (M6 review L14) ---------- */

/** Brief writes and clears run one after another, so a sign-out never loses a race to a brief that arrived just before it. */
let briefQueue = Promise.resolve();
function inOrder(task) {
  const run = briefQueue.then(task);
  briefQueue = run.catch(() => undefined);
  return run;
}

const jsonResponse = (body) => new Response(body, { headers: { "Content-Type": "application/json" } });

const clearBriefs = () => inOrder(() => caches.delete(BRIEF_CACHE));

/** The user `/offline` may show, or null. */
async function lastUser(cache) {
  try {
    const marker = await cache.match(BRIEF_USER_KEY);
    const data = marker ? await marker.json() : null;
    return data && typeof data.userId === "string" && USER_RE.test(data.userId) ? data.userId : null;
  } catch {
    return null;
  }
}

/** A brief cache without a user marker holds entries of an older worker (keyed by slug alone): none of them is anybody's now. */
async function dropUnownedBriefs() {
  const cache = await caches.open(BRIEF_CACHE);
  if ((await lastUser(cache)) === null) await caches.delete(BRIEF_CACHE);
}

/** The latest brief of one company for `userId`; a different user than the last one first empties the cache. */
async function keepBrief(userId, slug, body) {
  let cache = await caches.open(BRIEF_CACHE);
  if ((await lastUser(cache)) !== userId) {
    await caches.delete(BRIEF_CACHE);
    cache = await caches.open(BRIEF_CACHE);
    await cache.put(BRIEF_USER_KEY, jsonResponse(JSON.stringify({ userId, seenAt: new Date().toISOString() })));
  }
  await cache.put(`/brief/${userId}/${slug}`, jsonResponse(body));
}

function isLogin(url) {
  try {
    return new URL(url, self.location.origin).pathname === LOGIN_PATH;
  } catch {
    return false;
  }
}

/**
 * Network first; only when the network fails, the precached offline page.
 * The navigation itself is never stored. One that is for `/login`, or that
 * the server answered with a redirect to it, means there is no session on
 * this device any more: the cached briefs go.
 */
async function navigation(event) {
  const request = event.request;
  if (isLogin(request.url)) event.waitUntil(clearBriefs());
  try {
    const response = await fetch(request);
    if (response.redirected && isLogin(response.url)) await clearBriefs();
    return response;
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
  if (request.mode === "navigate") event.respondWith(navigation(event));
  // Everything else (API routes, RSC payloads, server actions, images) passes through untouched.
});

/**
 * From a page of this origin: `{ type: "brief", userId, slug, brief }` keeps
 * the latest brief of that company for that user; `{ type: "sign-out" }`
 * deletes every cached brief.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (event.origin && event.origin !== self.location.origin) return;
  if (data.type === "sign-out") {
    event.waitUntil(clearBriefs());
    return;
  }
  if (data.type !== "brief") return;
  if (typeof data.userId !== "string" || !USER_RE.test(data.userId)) return;
  if (typeof data.slug !== "string" || !SLUG_RE.test(data.slug) || typeof data.brief !== "object" || data.brief === null) return;
  const body = JSON.stringify({ userId: data.userId, slug: data.slug, brief: data.brief, cachedAt: new Date().toISOString() });
  if (body.length > BRIEF_MAX_BYTES) return;
  event.waitUntil(inOrder(() => keepBrief(data.userId, data.slug, body)));
});
