import { describe, expect, it } from "vitest";
import { BILLING_EVENT_TYPES } from "@north/core";
import { configFrom, report, runChecks, type CheckConfig, type CheckResult, type FetchLike } from "./production-check";

/** OPS-1 (ADR 0015): every check of the read-only production check against a fake fetch; no network, no write. */

const WEB = "https://north.example";
const WORKER = "https://north-worker.example";
const SUPABASE = "https://ref.supabase.example";
const ANON = "fake-anon-key-0123456789";
const STRIPE_KEY = "fake-restricted-read-key";
const USAGE_KEY = "fake-usage-read-key-0123";
const NOW = new Date("2026-11-20T10:00:00Z");

interface Route {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const healthyWorker = { ok: true, app: "north-worker", mode: "sandbox", runtime: "mock", webhooks: { sentry: true, stripe: true }, clockIsWall: true };
const goodManifest = {
  name: "North",
  start_url: "/companies",
  display: "standalone",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
const introspection = { function_count: 12, mode: "cloud", has_event_key: true, has_signing_key: true, schema_version: "2024-05-24" };
const endpoint = { id: "we_fake", url: `${WORKER}/webhooks/stripe`, status: "enabled", enabled_events: [...BILLING_EVENT_TYPES] };

/** The deployment the runbook describes, every route green. */
function green(): Record<string, Route> {
  return {
    [`GET ${WEB}/api/health`]: { json: { ok: true, app: "north-web", time: NOW.toISOString() } },
    [`GET ${WORKER}/health`]: { json: healthyWorker },
    [`GET ${SUPABASE}/rest/v1/companies?select=id&limit=1`]: { json: [] },
    [`POST ${SUPABASE}/storage/v1/object/list/artifacts`]: { json: [] },
    [`POST ${SUPABASE}/storage/v1/object/list/exports`]: { json: [] },
    [`GET ${SUPABASE}/storage/v1/bucket/artifacts`]: { status: 400, json: { error: "Bucket not found" } },
    [`GET ${SUPABASE}/storage/v1/bucket/exports`]: { status: 400, json: { error: "Bucket not found" } },
    [`GET ${WEB}/manifest.webmanifest`]: { json: goodManifest, headers: { "content-type": "application/manifest+json" } },
    [`GET ${WEB}/sw.js`]: { text: "self.addEventListener('push', () => {});", headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate" } },
    [`GET ${WEB}/api/inngest`]: { json: introspection },
    [`GET ${WORKER}/api/inngest`]: { json: { ...introspection, function_count: 31 } },
    [`GET https://api.stripe.com/v1/webhook_endpoints?limit=100`]: { json: { object: "list", data: [{ id: "we_other", url: "https://elsewhere.example/hook", status: "enabled", enabled_events: ["*"] }, endpoint] } },
    [`GET ${SUPABASE}/rest/v1/usage?period=eq.2026-11&select=user_id,llm_cost_usd,sandbox_minutes`]: { json: [{ user_id: "11111111-aaaa-4aaa-8aaa-111111111111", llm_cost_usd: 30, sandbox_minutes: 0 }] },
    [`GET ${SUPABASE}/rest/v1/entitlements?select=user_id,price_usd`]: { json: [{ user_id: "11111111-aaaa-4aaa-8aaa-111111111111", price_usd: 299 }] },
  };
}

function fake(routes: Record<string, Route>): { readonly fetch: FetchLike; readonly calls: readonly Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ method, url: input, headers });
    const route = routes[`${method} ${input}`];
    if (!route) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
    const body = route.text ?? JSON.stringify(route.json ?? null);
    return new Response(body, { status: route.status ?? 200, headers: { "content-type": "application/json", ...route.headers } });
  };
  return { fetch: fetchImpl, calls };
}

const config = (overrides: Partial<CheckConfig> = {}): CheckConfig => ({ webUrl: WEB, workerUrl: WORKER, supabaseUrl: SUPABASE, anonKey: ANON, stripeKey: STRIPE_KEY, usageKey: USAGE_KEY, allowDevInngest: false, now: NOW, ...overrides });

const byId = (results: readonly CheckResult[], id: string): CheckResult => {
  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`no result ${id}`);
  return found;
};

async function check(id: string, patch: Record<string, Route | undefined>, overrides: Partial<CheckConfig> = {}): Promise<CheckResult> {
  const routes = Object.fromEntries(Object.entries({ ...green(), ...patch }).filter((entry): entry is [string, Route] => entry[1] !== undefined));
  return byId(await runChecks(config(overrides), fake(routes).fetch), id);
}

describe("production check (OPS-1)", () => {
  it("is green against the deployment the runbook describes, with every check named", async () => {
    const { fetch, calls } = fake(green());
    const results = await runChecks(config(), fetch);
    expect(results.map((r) => r.id)).toEqual(["web-health", "worker-health", "anon-companies", "storage-artifacts", "storage-exports", "pwa-manifest", "pwa-service-worker", "inngest-web", "inngest-worker", "stripe-webhook", "usage-ratios"]);
    expect(results.filter((r) => r.status !== "pass")).toEqual([]);
    expect(byId(results, "worker-health").detail).toBe("mode sandbox, runtime mock, webhooks stripe on, sentry on, clock = wall");
    expect(report(config(), results, false)).toContain("production check: green");
    expect(calls.length).toBeGreaterThan(10);
  });

  it("changes nothing: GETs only, except the storage list (a read), and each key goes to its own host only", async () => {
    const { fetch, calls } = fake(green());
    await runChecks(config(), fetch);
    expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${SUPABASE}/storage/v1/object/list/artifacts`, `POST ${SUPABASE}/storage/v1/object/list/exports`]);
    for (const c of calls) {
      const auth = c.headers.authorization ?? "";
      if (c.url.startsWith("https://api.stripe.com/")) expect(auth).toBe(`Bearer ${STRIPE_KEY}`);
      else if (auth) expect(c.url.startsWith(SUPABASE)).toBe(true);
      expect(c.url).not.toContain(STRIPE_KEY);
      expect(c.url).not.toContain(ANON);
    }
    expect(calls.filter((c) => (c.headers.authorization ?? "").includes(USAGE_KEY)).every((c) => /\/rest\/v1\/(usage|entitlements)\?/.test(c.url))).toBe(true);
  });

  it("web health fails on a non-200 or a body that is not ok", async () => {
    expect((await check("web-health", { [`GET ${WEB}/api/health`]: { status: 500, json: { ok: false } } })).status).toBe("fail");
    expect((await check("web-health", { [`GET ${WEB}/api/health`]: { json: { ok: true, app: "something-else" } } })).status).toBe("fail");
  });

  it("worker health: a simulated clock fails, an unmounted Stripe webhook fails, the mode is reported either way", async () => {
    const route = `GET ${WORKER}/health`;
    const simulated = await check("worker-health", { [route]: { json: { ...healthyWorker, clockIsWall: false } } });
    expect(simulated).toMatchObject({ status: "fail" });
    expect(simulated.detail).toContain("not the wall clock");
    const unmounted = await check("worker-health", { [route]: { json: { ...healthyWorker, mode: "live", runtime: "claude-agent-sdk", webhooks: { sentry: "off", stripe: "off" } } } });
    expect(unmounted.status).toBe("fail");
    expect(unmounted.detail).toContain("mode live, runtime claude-agent-sdk");
    expect(unmounted.detail).toContain("STRIPE_WEBHOOK_SECRET");
    const older = await check("worker-health", { [route]: { json: { ok: true, app: "north-worker", time: NOW.toISOString(), clock: new Date(NOW.getTime() + 1500).toISOString(), webhooks: { stripe: "on" } } } });
    expect(older.status).toBe("pass");
    const drifted = await check("worker-health", { [route]: { json: { ok: true, time: NOW.toISOString(), clock: "2026-12-01T00:00:00Z", webhooks: { stripe: true } } } });
    expect(drifted.status).toBe("fail");
  });

  it("an anonymous select on companies must return zero rows (a refusal also passes)", async () => {
    const route = `GET ${SUPABASE}/rest/v1/companies?select=id&limit=1`;
    expect((await check("anon-companies", { [route]: { json: [{ id: "c1" }] } })).status).toBe("fail");
    expect((await check("anon-companies", { [route]: { status: 401, json: { code: "42501" } } })).status).toBe("pass");
    expect((await check("anon-companies", { [route]: { status: 500, json: {} } })).status).toBe("fail");
  });

  it("buckets: an anonymous list that shows objects fails, a public bucket fails, a refused list passes", async () => {
    expect((await check("storage-exports", { [`POST ${SUPABASE}/storage/v1/object/list/exports`]: { json: [{ name: "users" }] } })).status).toBe("fail");
    expect((await check("storage-artifacts", { [`GET ${SUPABASE}/storage/v1/bucket/artifacts`]: { json: { id: "artifacts", public: true } } })).status).toBe("fail");
    const refused = await check("storage-exports", { [`POST ${SUPABASE}/storage/v1/object/list/exports`]: { status: 400, json: { error: "not allowed" } } });
    expect(refused).toMatchObject({ status: "pass" });
    expect(refused.detail).toContain("refused (400)");
  });

  it("the manifest needs its content type, /companies, standalone, 192, 512 and a maskable icon", async () => {
    const route = `GET ${WEB}/manifest.webmanifest`;
    const wrong = await check("pwa-manifest", { [route]: { json: { ...goodManifest, display: "browser", icons: goodManifest.icons.slice(0, 1) }, headers: { "content-type": "text/html" } } });
    expect(wrong.status).toBe("fail");
    expect(wrong.detail).toContain("content-type text/html");
    expect(wrong.detail).toContain("display browser");
    expect(wrong.detail).toContain("icons 192 and 512");
    expect(wrong.detail).toContain("a maskable icon");
    expect((await check("pwa-manifest", { [route]: { status: 307, json: null } })).status).toBe("fail");
  });

  it("the service worker must be JavaScript; a cacheable one is a warning", async () => {
    const route = `GET ${WEB}/sw.js`;
    expect((await check("pwa-service-worker", { [route]: { text: "<html>login</html>", headers: { "content-type": "text/html" } } })).status).toBe("fail");
    expect((await check("pwa-service-worker", { [route]: { text: "self;", headers: { "content-type": "application/javascript", "cache-control": "public, max-age=31536000" } } })).status).toBe("warn");
  });

  it("Inngest: no functions fails, dev mode fails unless allowed, cloud mode needs both keys", async () => {
    const route = `GET ${WORKER}/api/inngest`;
    expect((await check("inngest-worker", { [route]: { json: { ...introspection, function_count: 0 } } })).status).toBe("fail");
    expect((await check("inngest-worker", { [route]: { json: { ...introspection, mode: "dev" } } })).status).toBe("fail");
    expect((await check("inngest-worker", { [route]: { json: { ...introspection, mode: "dev" } } }, { allowDevInngest: true })).status).toBe("pass");
    expect((await check("inngest-web", { [`GET ${WEB}/api/inngest`]: { json: { ...introspection, has_signing_key: false } } })).status).toBe("fail");
  });

  it("the Stripe endpoint: skipped without a key, missing, disabled or deaf to an event type fails", async () => {
    const route = "GET https://api.stripe.com/v1/webhook_endpoints?limit=100";
    expect(await check("stripe-webhook", {}, { stripeKey: null })).toMatchObject({ status: "skip" });
    expect((await check("stripe-webhook", { [route]: { json: { data: [] } } })).detail).toContain("run pnpm stripe:setup");
    expect((await check("stripe-webhook", { [route]: { json: { data: [{ ...endpoint, status: "disabled" }] } } })).status).toBe("fail");
    const deaf = await check("stripe-webhook", { [route]: { json: { data: [{ ...endpoint, enabled_events: ["invoice.paid"] }] } } });
    expect(deaf.status).toBe("fail");
    expect(deaf.detail).toContain("customer.subscription.deleted");
    const denied = await check("stripe-webhook", { [route]: { status: 401, json: { error: { code: "api_key_expired", message: "secret detail" } } } });
    expect(denied).toMatchObject({ status: "fail" });
    expect(denied.detail).toContain("api_key_expired");
    expect(denied.detail).not.toContain("secret detail");
  });

  it("usage: skipped without a key; a user at or over 40 % of the plan price is a warning", async () => {
    expect(await check("usage-ratios", {}, { usageKey: null })).toMatchObject({ status: "skip" });
    const green10 = await check("usage-ratios", {});
    expect(green10).toMatchObject({ status: "pass" });
    expect(green10.detail).toBe("2026-11: 11111111… 10 %");
    const hot = await check("usage-ratios", { [`GET ${SUPABASE}/rest/v1/usage?period=eq.2026-11&select=user_id,llm_cost_usd,sandbox_minutes`]: { json: [{ user_id: "11111111-aaaa-4aaa-8aaa-111111111111", llm_cost_usd: 120, sandbox_minutes: 0 }] } });
    expect(hot).toMatchObject({ status: "warn" });
    expect(hot.detail).toContain("40.1 %");
  });

  it("a network error or a timeout is a failure of that check, and the report counts it", async () => {
    const failing: FetchLike = async (input, init) => {
      if (input === `${WORKER}/health`) throw new Error("connect ECONNREFUSED");
      return fake(green()).fetch(input, init);
    };
    const results = await runChecks(config(), failing);
    expect(byId(results, "worker-health")).toEqual({ id: "worker-health", status: "fail", detail: "connect ECONNREFUSED" });
    expect(report(config(), results, false)).toContain("production check: 1 failed");
    const json = JSON.parse(report(config(), results, true)) as { ok: boolean; results: CheckResult[] };
    expect(json.ok).toBe(false);
    expect(json.results).toHaveLength(11);
  });

  it("reads flags first, then the environment, trims trailing slashes and refuses a missing anon key or an unknown flag", () => {
    const env = { NORTH_WEB_URL: `${WEB}/`, NORTH_WORKER_URL: WORKER, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON };
    const fromEnv = configFrom([], env, NOW);
    expect(fromEnv).toMatchObject({ webUrl: WEB, workerUrl: WORKER, supabaseUrl: SUPABASE, anonKey: ANON, stripeKey: null, usageKey: null, json: false, allowDevInngest: false });
    const fromFlags = configFrom(["--worker", "http://localhost:3101/", "--stripe-key", STRIPE_KEY, "--json", "--allow-dev-inngest"], env, NOW);
    expect(fromFlags).toMatchObject({ workerUrl: "http://localhost:3101", stripeKey: STRIPE_KEY, json: true, allowDevInngest: true });
    expect(() => configFrom([], { ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }, NOW)).toThrow(/anon-key/);
    expect(() => configFrom(["--web", "not a url"], env, NOW)).toThrow(/--web/);
    expect(() => configFrom(["--write"], env, NOW)).toThrow();
  });
});
