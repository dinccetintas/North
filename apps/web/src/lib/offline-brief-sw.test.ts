import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeBrief } from "@north/core/brief/compose";
import { briefView } from "./brief-view";
import { BRIEF_CACHE, BRIEF_USER_KEY, briefCacheKey, readCachedBriefs } from "./offline-brief";

/**
 * M6 review L14 against the real `public/sw.js`, loaded with an in-memory
 * Cache Storage: briefs are kept per user, a sign-out message or a
 * navigation that ends on `/login` clears them, a brief from another user
 * replaces the previous user's, and `/offline` reads only the user the worker
 * last saw.
 */

const ORIGIN = "https://north.test";
const U1 = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const U2 = "8b2f1d5f-3c4e-4f60-9bac-1d2e3f4a5b6c";
const SW_SOURCE = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

const keyOf = (request: RequestInfo | URL): string => (typeof request === "string" ? new URL(request, ORIGIN).href : request instanceof URL ? request.href : request.url);

class MemoryCache {
  readonly entries = new Map<string, Response>();
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(keyOf(request), response);
  }
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(keyOf(request))?.clone();
  }
  async keys(): Promise<readonly Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(keyOf(request));
  }
  async add(): Promise<void> {}
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>();
  async open(name: string): Promise<MemoryCache> {
    const existing = this.stores.get(name);
    if (existing) return existing;
    const created = new MemoryCache();
    this.stores.set(name, created);
    return created;
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async keys(): Promise<readonly string[]> {
    return [...this.stores.keys()];
  }
  async match(request: RequestInfo | URL, options: { cacheName?: string } = {}): Promise<Response | undefined> {
    const names = options.cacheName ? [options.cacheName] : [...this.stores.keys()];
    for (const name of names) {
      const hit = await this.stores.get(name)?.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
  /** The brief cache's keys as paths, for assertions. */
  briefPaths(): readonly string[] {
    return [...(this.stores.get(BRIEF_CACHE)?.entries.keys() ?? [])].map((url) => new URL(url).pathname).sort();
  }
}

type Handler = (event: Record<string, unknown>) => void;
type NavigationAnswer = { readonly redirected: boolean; readonly url: string } | "offline";

let storage: MemoryCacheStorage;
let handlers: Map<string, Handler>;
let answer: NavigationAnswer;

/** Evaluates sw.js the way a browser runs it: `self`, `caches` and `fetch` are the worker's globals. */
function loadWorker(): Map<string, Handler> {
  const registered = new Map<string, Handler>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => registered.set(type, handler),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => null },
    registration: { showNotification: async () => undefined },
  };
  const fetchImpl = async () => {
    if (answer === "offline") throw new TypeError("Failed to fetch");
    return { ok: true, type: "basic", status: 200, ...answer };
  };
  new Function("self", "caches", "fetch", SW_SOURCE)(self, storage, fetchImpl);
  return registered;
}

async function dispatch(type: string, event: Record<string, unknown>): Promise<unknown> {
  const pending: Promise<unknown>[] = [];
  let response: Promise<unknown> | undefined;
  handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p), respondWith: (p: Promise<unknown>) => (response = p) });
  const answered = await response;
  await Promise.all(pending);
  return answered;
}

const message = (data: unknown, origin = ORIGIN) => dispatch("message", { data, origin });
const navigate = (path: string) => dispatch("fetch", { request: { method: "GET", url: `${ORIGIN}${path}`, mode: "navigate" } });

const brief = (companyName: string, day = "2026-10-16") =>
  briefView(composeBrief({ day, companyName, stopped: false, blocked: null, yesterday: { outcomes: [], actions: [] }, metrics: [], goal: null, decisions: { pending: [], deferred: 0, answeredYesterday: 0 }, today: [], spend: [], signals: [], escalations: [] }));

beforeEach(() => {
  storage = new MemoryCacheStorage();
  answer = { redirected: false, url: `${ORIGIN}/c/acme` };
  handlers = loadWorker();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M6 review L14: the service worker's brief cache", () => {
  it("keeps a brief under /brief/<userId>/<slug> with the user marker; malformed or foreign messages store nothing", async () => {
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    expect(storage.briefPaths()).toEqual([`/brief/${U1}/acme`, BRIEF_USER_KEY].sort());
    expect(await (await storage.match(BRIEF_USER_KEY, { cacheName: BRIEF_CACHE }))?.json()).toMatchObject({ userId: U1 });
    expect(await (await storage.match(briefCacheKey(U1, "acme"), { cacheName: BRIEF_CACHE }))?.json()).toMatchObject({ userId: U1, slug: "acme", brief: { companyName: "Acme" } });

    storage = new MemoryCacheStorage();
    handlers = loadWorker();
    for (const data of [
      { type: "brief", slug: "acme", brief: brief("Acme") },
      { type: "brief", userId: U1.toUpperCase(), slug: "acme", brief: brief("Acme") },
      { type: "brief", userId: "../../x", slug: "acme", brief: brief("Acme") },
      { type: "brief", userId: U1, slug: "../x", brief: brief("Acme") },
      { type: "brief", userId: U1, slug: "acme", brief: null },
      { type: "brief", userId: U1, slug: "acme", brief: { headline: "x".repeat(70_000) } },
      null,
      "brief",
    ])
      await message(data);
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") }, "https://evil.example");
    expect(storage.briefPaths()).toEqual([]);
  });

  it("a brief from another user first removes the previous user's briefs", async () => {
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    await message({ type: "brief", userId: U1, slug: "beta", brief: brief("Beta") });
    expect(storage.briefPaths()).toEqual([`/brief/${U1}/acme`, `/brief/${U1}/beta`, BRIEF_USER_KEY].sort());
    await message({ type: "brief", userId: U2, slug: "gamma", brief: brief("Gamma") });
    expect(storage.briefPaths()).toEqual([`/brief/${U2}/gamma`, BRIEF_USER_KEY].sort());
  });

  it("{ type: 'sign-out' } deletes north-brief-v1, also right after a brief still being written", async () => {
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    await message({ type: "sign-out" });
    expect(storage.stores.has(BRIEF_CACHE)).toBe(false);
    await Promise.all([message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") }), message({ type: "sign-out" })]);
    expect(storage.briefPaths()).toEqual([]);
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    await message({ type: "sign-out" }, "https://evil.example");
    expect(storage.briefPaths()).toHaveLength(2);
  });

  it("a navigation to /login, or one the server redirects to /login, clears the briefs; other navigations keep them", async () => {
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    await navigate("/c/acme");
    await navigate("/settings");
    expect(storage.briefPaths()).toHaveLength(2);
    answer = { redirected: true, url: `${ORIGIN}/login?next=%2Fc%2Facme` };
    await navigate("/c/acme");
    expect(storage.briefPaths()).toEqual([]);

    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    answer = { redirected: false, url: `${ORIGIN}/login?next=%2Fc%2Facme` };
    await navigate("/login?next=%2Fc%2Facme");
    expect(storage.briefPaths()).toEqual([]);

    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    answer = { redirected: true, url: `${ORIGIN}/companies` };
    await navigate("/login");
    expect(storage.briefPaths()).toEqual([]);
  });

  it("offline, a navigation still falls back to /offline and keeps the briefs", async () => {
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    await (await storage.open("north-static-v1")).put("/offline", new Response("<main>offline</main>"));
    answer = "offline";
    const response = (await navigate("/c/acme")) as Response;
    expect(await response.text()).toContain("offline");
    expect(storage.briefPaths()).toHaveLength(2);
  });

  it("activating a worker drops a brief cache without the user marker (entries an older worker kept)", async () => {
    await (await storage.open(BRIEF_CACHE)).put("/brief/acme", new Response(JSON.stringify({ slug: "acme" })));
    await dispatch("activate", {});
    expect(storage.stores.has(BRIEF_CACHE)).toBe(false);
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    await dispatch("activate", {});
    expect(storage.briefPaths()).toHaveLength(2);
  });

  it("/offline reads only the briefs of the user the worker last saw", async () => {
    await message({ type: "brief", userId: U1, slug: "acme", brief: brief("Acme") });
    await message({ type: "brief", userId: U1, slug: "beta", brief: brief("Beta") });
    const stray = { userId: U2, slug: "gamma", brief: brief("Gamma"), cachedAt: "2026-10-16T07:00:00.000Z" };
    await (await storage.open(BRIEF_CACHE)).put(briefCacheKey(U2, "gamma"), new Response(JSON.stringify(stray)));
    vi.stubGlobal("caches", storage);
    expect((await readCachedBriefs()).map((e) => `${e.userId}/${e.slug}`).sort()).toEqual([`${U1}/acme`, `${U1}/beta`]);
    await message({ type: "sign-out" });
    expect(await readCachedBriefs()).toEqual([]);
  });
});
