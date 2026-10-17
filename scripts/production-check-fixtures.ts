/** OPS-1, STG-1, TST-5: the fake deployment the production check's tests run against (shared by `production-check.test.ts` and `production-check-env.test.ts`); no network. */
import { BILLING_EVENT_TYPES } from "@north/core";
import { runChecks, type CheckConfig, type CheckResult, type FetchLike } from "./production-check";

/** The fake deployment's URLs, keys and clock. */
export const WEB = "https://north.example";
export const WORKER = "https://north-worker.example";
export const SUPABASE = "https://ref.supabase.example";
export const ANON = "fake-anon-key-0123456789";
export const STRIPE_KEY = "fake-restricted-read-key";
export const USAGE_KEY = "fake-usage-read-key-0123";
export const NOW = new Date("2026-11-20T10:00:00Z");

/** One faked answer: a status (200 by default), a JSON or text body and extra headers. */
export interface Route {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** One request the check made, as the fake saw it. */
export interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** A production worker on the mock runtime, every field the check reads green. */
export const healthyWorker = { ok: true, app: "north-worker", mode: "sandbox", runtime: "mock", webhooks: { sentry: true, stripe: true }, unsubscribe: true, clockIsWall: true, profile: "production", fence: false, gateway: "off", env: "production", budget: null };
/** A staging worker on the SDK runtime: the fence on, the smoke profile, the gateway recording, its day's budget on the line. */
export const stagingWorker = { ...healthyWorker, mode: "live", runtime: "claude-agent-sdk", profile: "smoke", fence: true, gateway: "record", env: "staging", budget: { capUsd: 0.5, spentUsd: 0.1, unpriced: 0, exhausted: false } };
/** A manifest with the content the PWA check asks for. */
export const goodManifest = {
  name: "North",
  start_url: "/companies",
  display: "standalone",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
/** An Inngest serve endpoint in cloud mode with both keys; `endpoint` is the worker's Stripe webhook endpoint. */
export const introspection = { function_count: 12, mode: "cloud", has_event_key: true, has_signing_key: true, schema_version: "2024-05-24" };
export const endpoint = { id: "we_fake", url: `${WORKER}/webhooks/stripe`, status: "enabled", enabled_events: [...BILLING_EVENT_TYPES] };

/** The deployment the runbook describes, every route green. */
export function green(): Record<string, Route> {
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

/** A fetch that answers from `routes` (404 JSON otherwise) and records every call. */
export function fake(routes: Record<string, Route>): { readonly fetch: FetchLike; readonly calls: readonly Call[] } {
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

/** The check's config for the fake deployment (production env), with overrides. */
export const config = (overrides: Partial<CheckConfig> = {}): CheckConfig => ({ env: "production", webUrl: WEB, workerUrl: WORKER, supabaseUrl: SUPABASE, anonKey: ANON, stripeKey: STRIPE_KEY, usageKey: USAGE_KEY, allowDevInngest: false, now: NOW, ...overrides });

/** The result with this id; throws when the check did not report it. */
export const byId = (results: readonly CheckResult[], id: string): CheckResult => {
  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`no result ${id}`);
  return found;
};

/** Runs every check against the green deployment with `patch` applied (an undefined route is removed) and returns the one with this id. */
export async function check(id: string, patch: Record<string, Route | undefined>, overrides: Partial<CheckConfig> = {}): Promise<CheckResult> {
  const routes = Object.fromEntries(Object.entries({ ...green(), ...patch }).filter((entry): entry is [string, Route] => entry[1] !== undefined));
  return byId(await runChecks(config(overrides), fake(routes).fetch), id);
}
