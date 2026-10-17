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

const healthyWorker = { ok: true, app: "north-worker", mode: "sandbox", runtime: "mock", webhooks: { sentry: true, stripe: true }, unsubscribe: true, clockIsWall: true, profile: "production", fence: false, gateway: "off", env: "production", budget: null };
/** A staging worker on the SDK runtime: the fence on, the smoke profile, the gateway recording, its day's budget on the line. */
const stagingWorker = { ...healthyWorker, mode: "live", runtime: "claude-agent-sdk", profile: "smoke", fence: true, gateway: "record", env: "staging", budget: { capUsd: 0.5, spentUsd: 0.1, unpriced: 0, exhausted: false } };
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
    [`GET ${WEB}/api/health`]: { json: { ok: true, app: "north-web", time: NOW.toISOString(), llm: "mock" } },
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

const config = (overrides: Partial<CheckConfig> = {}): CheckConfig => ({ env: "production", webUrl: WEB, workerUrl: WORKER, supabaseUrl: SUPABASE, anonKey: ANON, stripeKey: STRIPE_KEY, usageKey: USAGE_KEY, allowDevInngest: false, now: NOW, ...overrides });

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
    expect(results.map((r) => r.id)).toEqual(["web-health", "worker-health", "worker-no-sandbox", "anon-companies", "storage-artifacts", "storage-exports", "pwa-manifest", "pwa-service-worker", "inngest-web", "inngest-worker", "stripe-webhook", "usage-ratios"]);
    expect(results.filter((r) => r.status !== "pass")).toEqual([]);
    expect(byId(results, "worker-health").detail).toBe("mode sandbox, runtime mock, webhooks stripe on, sentry on, clock = wall, profile production, fence off, gateway off, env production");
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
    const withoutWall = Object.fromEntries(Object.entries(healthyWorker).filter(([key]) => key !== "clockIsWall"));
    const older = await check("worker-health", { [route]: { json: { ...withoutWall, time: NOW.toISOString(), clock: new Date(NOW.getTime() + 1500).toISOString(), webhooks: { stripe: "on" } } } });
    expect(older.status).toBe("pass");
    const drifted = await check("worker-health", { [route]: { json: { ok: true, time: NOW.toISOString(), clock: "2026-12-01T00:00:00Z", webhooks: { stripe: true } } } });
    expect(drifted.status).toBe("fail");
  });

  it("M6 review L5: the public worker serves no sandbox site and no clock (404); a mounted or guarded route fails", async () => {
    const closed = await check("worker-no-sandbox", {});
    expect(closed).toEqual({ id: "worker-no-sandbox", status: "pass", detail: "GET /sandbox/sites/ → 404, GET /sandbox/clock → 404" });
    const sites = await check("worker-no-sandbox", { [`GET ${WORKER}/sandbox/sites/`]: { text: "<h1>agent page</h1>", headers: { "content-type": "text/html" } } });
    expect(sites).toMatchObject({ status: "fail" });
    expect(sites.detail).toContain("GET /sandbox/sites/ → 200");
    expect(sites.detail).toContain("WORKER_HOST");
    const clock = await check("worker-no-sandbox", { [`GET ${WORKER}/sandbox/clock`]: { status: 403, json: { error: "sandbox endpoints answer this machine only" } } });
    expect(clock).toMatchObject({ status: "fail" });
    expect(clock.detail).toContain("GET /sandbox/clock → 403");
    const { fetch, calls } = fake(green());
    await runChecks(config(), fetch);
    expect(calls.filter((c) => c.url.startsWith(`${WORKER}/sandbox/`)).map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${WORKER}/sandbox/sites/`, `GET ${WORKER}/sandbox/clock`]);
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
    // The expected list is core's BILLING_EVENT_TYPES, the one `stripe:setup` registers: the seventh type counts like the first six.
    expect(BILLING_EVENT_TYPES).toContain("checkout.session.async_payment_succeeded");
    const withoutAsync = await check("stripe-webhook", { [route]: { json: { data: [{ ...endpoint, enabled_events: BILLING_EVENT_TYPES.filter((t) => t !== "checkout.session.async_payment_succeeded") }] } } });
    expect(withoutAsync).toMatchObject({ status: "fail", detail: expect.stringContaining("checkout.session.async_payment_succeeded") });
    expect((await check("stripe-webhook", {})).detail).toContain(`enabled for ${BILLING_EVENT_TYPES.length} event types`);
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
    expect(json.results).toHaveLength(12);
  });

  it("reads flags first, then the environment, trims trailing slashes and refuses a missing anon key or an unknown flag", () => {
    const env = { NORTH_WEB_URL: `${WEB}/`, NORTH_WORKER_URL: WORKER, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON };
    const fromEnv = configFrom([], env, NOW);
    expect(fromEnv).toMatchObject({ env: "production", webUrl: WEB, workerUrl: WORKER, supabaseUrl: SUPABASE, anonKey: ANON, stripeKey: null, usageKey: null, json: false, allowDevInngest: false });
    const fromFlags = configFrom(["--worker", "http://localhost:3101/", "--json", "--allow-dev-inngest"], { ...env, STRIPE_READ_KEY: STRIPE_KEY }, NOW);
    expect(fromFlags).toMatchObject({ workerUrl: "http://localhost:3101", stripeKey: STRIPE_KEY, json: true, allowDevInngest: true });
    expect(() => configFrom([], { ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }, NOW)).toThrow(/anon-key/);
    expect(() => configFrom(["--web", "not a url"], env, NOW)).toThrow(/--web/);
    expect(() => configFrom(["--write"], env, NOW)).toThrow();
  });

  it("M6 review L11: the usage and Stripe keys come from the environment only; a key flag is refused without echoing the key", () => {
    const env = { NORTH_WEB_URL: WEB, NORTH_WORKER_URL: WORKER, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON };
    expect(configFrom([], { ...env, NORTH_USAGE_READ_KEY: ` ${USAGE_KEY} `, STRIPE_READ_KEY: STRIPE_KEY }, NOW)).toMatchObject({ usageKey: USAGE_KEY, stripeKey: STRIPE_KEY });
    for (const argv of [["--usage-key", USAGE_KEY], [`--usage-key=${USAGE_KEY}`], ["--stripe-key", STRIPE_KEY], [`--stripe-key=${STRIPE_KEY}`]]) {
      let message = "";
      try {
        configFrom(argv, env, NOW);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/NORTH_USAGE_READ_KEY|STRIPE_READ_KEY/);
      expect(message).toContain("environment");
      expect(message).not.toContain(USAGE_KEY);
      expect(message).not.toContain(STRIPE_KEY);
    }
  });

  it("names the environment variable when a key is missing", async () => {
    expect((await check("usage-ratios", {}, { usageKey: null })).detail).toContain("NORTH_USAGE_READ_KEY");
    expect((await check("stripe-webhook", {}, { stripeKey: null })).detail).toContain("STRIPE_READ_KEY");
  });
});

const workerRoute = `GET ${WORKER}/health`;
const webHealthRoute = `GET ${WEB}/api/health`;
const urlEnv = { NORTH_WEB_URL: WEB, NORTH_WORKER_URL: WORKER, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON };
/** The worker-health check against one health line, in one env. */
const workerCheck = (line: object, env: CheckConfig["env"] = "production"): Promise<CheckResult> => check("worker-health", { [workerRoute]: { json: line } }, { env });
const failing = (part: string) => ({ status: "fail", detail: expect.stringContaining(part) });

describe("STG-1 staging check", () => {
  it("a staging line with the fence off fails, and the message names the fence", async () => {
    const result = await workerCheck({ ...stagingWorker, fence: false }, "staging");
    expect(result).toMatchObject(failing("fence is false"));
    expect(result.detail).toContain("NORTH_TEST_FENCE=1");
  });

  it("fence on, env staging, the smoke profile and a recording gateway pass, with what it found in the detail", async () => {
    const result = await workerCheck({ ...stagingWorker, profile: "smoke", fence: true, env: "staging", gateway: "record" }, "staging");
    expect(result).toMatchObject({ id: "worker-health", status: "pass" });
    expect(result.detail).toBe("mode live, runtime claude-agent-sdk, webhooks stripe on, sentry on, clock = wall, profile smoke, fence on, gateway record, env staging");
  });

  it("any of the three profiles passes in staging; a gateway that replays, a production env or a missing budget on the SDK runtime fails", async () => {
    for (const profile of ["production", "staging", "smoke"]) expect((await workerCheck({ ...stagingWorker, profile }, "staging")).status).toBe("pass");
    expect(await workerCheck({ ...stagingWorker, gateway: "replay" }, "staging")).toMatchObject(failing('gateway is "replay"'));
    expect(await workerCheck({ ...stagingWorker, env: "production" }, "staging")).toMatchObject(failing('env is "production"'));
    expect(await workerCheck({ ...stagingWorker, budget: null }, "staging")).toMatchObject(failing("budget"));
  });

  it("the production worker fails the staging check, and every failure is in the detail at once", async () => {
    const result = await workerCheck({ ...healthyWorker, clockIsWall: false }, "staging");
    expect(result.status).toBe("fail");
    for (const part of ["not the wall clock", "fence is false", 'env is "production"']) expect(result.detail).toContain(part);
  });

  it("every other check runs unchanged in staging: the same requests, green against a staging deployment, named in the report", async () => {
    const asProduction = fake(green());
    const asStaging = fake({ ...green(), [workerRoute]: { json: stagingWorker } });
    await runChecks(config(), asProduction.fetch);
    const results = await runChecks(config({ env: "staging" }), asStaging.fetch);
    expect(asStaging.calls.map((c) => `${c.method} ${c.url}`)).toEqual(asProduction.calls.map((c) => `${c.method} ${c.url}`));
    expect(results.map((r) => r.id)).toEqual(["web-health", "worker-health", "worker-no-sandbox", "anon-companies", "storage-artifacts", "storage-exports", "pwa-manifest", "pwa-service-worker", "inngest-web", "inngest-worker", "stripe-webhook", "usage-ratios"]);
    expect(results.filter((r) => r.status !== "pass")).toEqual([]);
    expect(report(config({ env: "staging" }), results, false)).toContain("staging check: green");
    expect((await check("worker-no-sandbox", { [`GET ${WORKER}/sandbox/clock`]: { status: 403, json: {} } }, { env: "staging" })).status).toBe("fail");
    expect((await check("anon-companies", { [`GET ${SUPABASE}/rest/v1/companies?select=id&limit=1`]: { json: [{ id: "c1" }] } }, { env: "staging" })).status).toBe("fail");
    expect((await check("inngest-worker", { [`GET ${WORKER}/api/inngest`]: { json: { ...introspection, mode: "dev" } } }, { env: "staging" })).status).toBe("fail");
  });

  it("a failed staging report names the env, and the JSON carries it", async () => {
    const results = await runChecks(config({ env: "staging" }), fake({ ...green(), [workerRoute]: { json: { ...stagingWorker, fence: false } } }).fetch);
    expect(report(config({ env: "staging" }), results, false)).toContain("staging check: 1 failed");
    expect(JSON.parse(report(config({ env: "staging" }), results, true))).toMatchObject({ env: "staging", ok: false });
  });

  it("--env staging, --env=staging and NORTH_CHECK_ENV=staging select staging; the flag wins; production is the default and a blank variable is unset", () => {
    expect(configFrom(["--env", "staging"], urlEnv, NOW).env).toBe("staging");
    expect(configFrom(["--env=staging"], urlEnv, NOW).env).toBe("staging");
    expect(configFrom([], { ...urlEnv, NORTH_CHECK_ENV: " staging " }, NOW).env).toBe("staging");
    expect(configFrom(["--env", "production"], { ...urlEnv, NORTH_CHECK_ENV: "staging" }, NOW).env).toBe("production");
    expect(configFrom(["--env", "staging"], { ...urlEnv, NORTH_CHECK_ENV: "nonsense" }, NOW).env).toBe("staging");
    expect(configFrom([], urlEnv, NOW).env).toBe("production");
    expect(configFrom([], { ...urlEnv, NORTH_CHECK_ENV: "  " }, NOW).env).toBe("production");
  });
});

describe("TST-5 production check", () => {
  it("a fence that is on fails in production, naming the fence", async () => {
    expect(await workerCheck({ ...healthyWorker, fence: true })).toMatchObject(failing("fence is true"));
  });

  it("a staging profile, a staging env or a recording gateway fails in production", async () => {
    for (const [field, value] of [["profile", "smoke"], ["env", "staging"], ["gateway", "record"]] as const) expect(await workerCheck({ ...healthyWorker, [field]: value })).toMatchObject(failing(`${field} is "${value}"`));
  });

  it("a gateway that replays fails in production and in staging", async () => {
    expect(await workerCheck({ ...healthyWorker, gateway: "replay" })).toMatchObject(failing('gateway is "replay"'));
    expect(await workerCheck({ ...stagingWorker, gateway: "replay" }, "staging")).toMatchObject(failing('gateway is "replay"'));
  });

  it("a live worker that cannot verify unsubscribe links fails in both envs; a sandbox worker is not asked", async () => {
    for (const [env, line] of [["production", healthyWorker], ["staging", stagingWorker]] as const) {
      const live = await workerCheck({ ...line, mode: "live", unsubscribe: false }, env);
      expect(live).toMatchObject(failing("unsubscribe is false"));
      expect(live.detail).toContain("UNSUBSCRIBE_SECRET");
      expect((await workerCheck({ ...line, mode: "sandbox", unsubscribe: false }, env)).status).toBe("pass");
    }
  });

  it("a spent day's budget fails in production and is read, not failed, in staging", async () => {
    const spent = { capUsd: 0.5, spentUsd: 0.5, unpriced: 0, exhausted: true };
    expect(await workerCheck({ ...healthyWorker, runtime: "claude-agent-sdk", gateway: "live", budget: spent })).toMatchObject(failing("budget"));
    expect((await workerCheck({ ...healthyWorker, gateway: "live", budget: { ...spent, exhausted: false } })).status).toBe("pass");
    expect((await workerCheck({ ...stagingWorker, budget: spent }, "staging")).status).toBe("pass");
  });

  it("a worker older than this check (no profile, fence, gateway, env) fails, saying so", async () => {
    const result = await workerCheck({ ok: true, app: "north-worker", mode: "sandbox", runtime: "mock", webhooks: { stripe: true }, clockIsWall: true });
    expect(result.status).toBe("fail");
    for (const field of ["profile", "fence", "gateway", "env"]) expect(result.detail).toContain(`${field} is missing`);
    expect(result.detail).toContain("older than this check");
  });

  it("the web must not call the model: llm live fails and a missing llm fails as older than this check, in both envs", async () => {
    for (const env of ["production", "staging"] as const) {
      expect(await check("web-health", { [webHealthRoute]: { json: { ok: true, app: "north-web", llm: "live" } } }, { env })).toMatchObject(failing('llm is "live"'));
      const older = await check("web-health", { [webHealthRoute]: { json: { ok: true, app: "north-web", time: NOW.toISOString() } } }, { env });
      expect(older).toMatchObject(failing("older than this check"));
      expect(older.detail).toContain("llm");
      expect((await check("web-health", {}, { env })).status).toBe("pass");
    }
  });

  it("--env nonsense is a usage error naming the flag, the value and the two envs; so is a nonsense NORTH_CHECK_ENV or a second --env", () => {
    expect(() => configFrom(["--env", "nonsense"], urlEnv, NOW)).toThrow(/--env.*nonsense.*production.*staging/s);
    for (const value of ["Staging", ""]) expect(() => configFrom(["--env", value], urlEnv, NOW)).toThrow(/--env/);
    expect(() => configFrom([], { ...urlEnv, NORTH_CHECK_ENV: "nonsense" }, NOW)).toThrow(/NORTH_CHECK_ENV.*nonsense.*production.*staging/s);
    expect(() => configFrom(["--env"], urlEnv, NOW)).toThrow();
    expect(() => configFrom(["--env", "staging", "--env", "production"], urlEnv, NOW)).toThrow(/--env.*once/);
  });
});
