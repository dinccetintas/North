/**
 * OPS-1 (ADR 0015): the read-only production check. It reads the live
 * deployment the founder points it at and changes nothing: no write, no
 * service role key. It is the last step of `docs/runbooks/production.md` and
 * the first step of any incident.
 *
 *   web and worker health lines (mode, runtime, webhooks mounted, clock = wall)
 *   an anonymous select on `companies` returns zero rows
 *   both storage buckets refuse an anonymous list and are not public
 *   the manifest and the service worker with the right content types
 *   the Inngest introspection of both serve endpoints (function count, cloud mode, keys)
 *   the Stripe webhook endpoint for the worker exists and is enabled (a restricted read-only key)
 *   every user's usage ratio for the month (only with a key that may read `usage`)
 *
 * Usage:
 *   pnpm production:check -- --web https://<web> --worker https://<worker> \
 *     --supabase https://<ref>.supabase.co --anon-key <anon key> \
 *     [--stripe-key <restricted read-only key>] [--usage-key <key>] [--json] [--allow-dev-inngest]
 * Env fallbacks: NORTH_WEB_URL, NORTH_WORKER_URL, NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, STRIPE_READ_KEY, NORTH_USAGE_READ_KEY.
 * Exit 1 when any check fails; `skip` and `warn` do not fail.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BILLING_EVENT_TYPES, USAGE_ALERT_RATIO, usageRatio } from "@north/core";
import { localMonth } from "@north/core/time";
import { stripeCall } from "../packages/integrations/src/live/stripe-http";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type CheckStatus = "pass" | "fail" | "skip" | "warn";

export interface CheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface CheckConfig {
  readonly webUrl: string;
  readonly workerUrl: string;
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly stripeKey: string | null;
  readonly usageKey: string | null;
  /** Local runs only: accept an Inngest serve endpoint in dev mode. */
  readonly allowDevInngest: boolean;
  readonly now: Date;
}

const TIMEOUT_MS = 10_000;
const CLOCK_SKEW_MS = 5_000;
const BUCKETS = ["artifacts", "exports"] as const;
const result = (id: string, status: CheckStatus, detail: string): CheckResult => Object.freeze({ id, status, detail });

/* ---------- reading untrusted JSON without trusting it ---------- */

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (o: Obj, key: string): string | null => (typeof o[key] === "string" ? (o[key] as string) : null);
const num = (o: Obj, key: string): number | null => (typeof o[key] === "number" && Number.isFinite(o[key]) ? (o[key] as number) : null);
const on = (v: unknown): boolean => v === true || v === "on";

interface Fetched {
  readonly status: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly json: unknown;
}

async function fetchJson(f: FetchLike, url: string, init: RequestInit = {}): Promise<Fetched> {
  const response = await f(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", cacheControl: response.headers.get("cache-control") ?? "", json };
}

const anonHeaders = (key: string): Record<string, string> => ({ apikey: key, authorization: `Bearer ${key}` });

/* ---------- the checks ---------- */

export async function webHealth(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const r = await fetchJson(f, `${c.webUrl}/api/health`);
  const ok = r.status === 200 && isObj(r.json) && r.json.ok === true && (str(r.json, "app") ?? "north-web") === "north-web";
  return result("web-health", ok ? "pass" : "fail", ok ? "GET /api/health ok" : `GET /api/health → ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
}

/** The worker's line: `{ ok, mode, runtime, webhooks: { sentry, stripe }, clockIsWall }`; the Stripe webhook must be mounted and the clock must be the wall's. */
export async function workerHealth(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const r = await fetchJson(f, `${c.workerUrl}/health`);
  if (r.status !== 200 || !isObj(r.json) || r.json.ok !== true) return result("worker-health", "fail", `GET /health → ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
  const h = r.json;
  const webhooks = isObj(h.webhooks) ? h.webhooks : {};
  const clock = str(h, "clock");
  const time = str(h, "time");
  const clockIsWall = typeof h.clockIsWall === "boolean" ? h.clockIsWall : clock !== null && time !== null && Math.abs(Date.parse(clock) - Date.parse(time)) <= CLOCK_SKEW_MS;
  const detail = `mode ${str(h, "mode") ?? "?"}, runtime ${str(h, "runtime") ?? "?"}, webhooks stripe ${on(webhooks.stripe) ? "on" : "off"}, sentry ${on(webhooks.sentry) ? "on" : "off"}, clock ${clockIsWall ? "= wall" : "simulated"}`;
  if (!clockIsWall) return result("worker-health", "fail", `${detail}: the worker clock is not the wall clock (NORTH_CLOCK_START or /sandbox/clock in production)`);
  if (!on(webhooks.stripe)) return result("worker-health", "fail", `${detail}: the Stripe webhook is not mounted (set STRIPE_WEBHOOK_SECRET on Fly)`);
  return result("worker-health", "pass", detail);
}

export async function anonCompanies(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const r = await fetchJson(f, `${c.supabaseUrl}/rest/v1/companies?select=id&limit=1`, { headers: anonHeaders(c.anonKey) });
  if (r.status === 200 && Array.isArray(r.json)) return result("anon-companies", r.json.length === 0 ? "pass" : "fail", r.json.length === 0 ? "anonymous select on companies: 0 rows" : "anonymous select on companies returned rows: RLS is off");
  if (r.status === 401 || r.status === 403) return result("anon-companies", "pass", `anonymous select on companies refused (${r.status})`);
  return result("anon-companies", "fail", `anonymous select on companies → ${r.status}`);
}

/** Read-only probes: the list API (a POST that reads) must show the anonymous caller nothing, and the bucket must not be public. */
export async function bucketPrivate(c: CheckConfig, f: FetchLike, bucket: string): Promise<CheckResult> {
  const id = `storage-${bucket}`;
  const list = await fetchJson(f, `${c.supabaseUrl}/storage/v1/object/list/${bucket}`, { method: "POST", headers: { ...anonHeaders(c.anonKey), "content-type": "application/json" }, body: JSON.stringify({ prefix: "", limit: 1, offset: 0 }) });
  if (list.status === 200 && Array.isArray(list.json) && list.json.length > 0) return result(id, "fail", `an anonymous list of ${bucket} returned objects`);
  if (list.status === 200 && !Array.isArray(list.json)) return result(id, "fail", `an anonymous list of ${bucket} answered something else`);
  const meta = await fetchJson(f, `${c.supabaseUrl}/storage/v1/bucket/${bucket}`, { headers: anonHeaders(c.anonKey) });
  if (meta.status === 200 && isObj(meta.json) && meta.json.public === true) return result(id, "fail", `bucket ${bucket} is public`);
  return result(id, "pass", `anonymous list of ${bucket}: ${list.status === 200 ? "empty" : `refused (${list.status})`}; ${meta.status === 200 ? "not public" : "metadata hidden"}`);
}

/** PWA-1: `/manifest.webmanifest` as `application/manifest+json`, start URL, standalone, 192/512 and a maskable icon. */
export async function manifest(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const r = await fetchJson(f, `${c.webUrl}/manifest.webmanifest`);
  if (r.status !== 200 || !isObj(r.json)) return result("pwa-manifest", "fail", `GET /manifest.webmanifest → ${r.status}`);
  const icons = Array.isArray(r.json.icons) ? r.json.icons.filter(isObj) : [];
  const sizes = new Set(icons.flatMap((i) => (str(i, "sizes") ?? "").split(/\s+/)));
  const problems = [
    r.contentType.includes("manifest+json") ? null : `content-type ${r.contentType || "missing"}`,
    str(r.json, "start_url") === "/companies" ? null : `start_url ${str(r.json, "start_url")}`,
    str(r.json, "display") === "standalone" ? null : `display ${str(r.json, "display")}`,
    sizes.has("192x192") && sizes.has("512x512") ? null : "icons 192 and 512",
    icons.some((i) => (str(i, "purpose") ?? "").includes("maskable")) ? null : "a maskable icon",
  ].filter((p): p is string => p !== null);
  return result("pwa-manifest", problems.length === 0 ? "pass" : "fail", problems.length === 0 ? `${str(r.json, "name")}: standalone, /companies, ${icons.length} icons` : `missing or wrong: ${problems.join(", ")}`);
}

export async function serviceWorker(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const response = await f(`${c.webUrl}/sw.js`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const type = response.headers.get("content-type") ?? "";
  const cache = response.headers.get("cache-control") ?? "";
  await response.text();
  if (response.status !== 200 || !type.includes("javascript")) return result("pwa-service-worker", "fail", `GET /sw.js → ${response.status} ${type || "no content-type"}`);
  if (!/no-cache|no-store/.test(cache)) return result("pwa-service-worker", "warn", `served as ${type}, but cache-control "${cache}" lets an old worker linger`);
  return result("pwa-service-worker", "pass", `served as ${type}, ${cache}`);
}

/** The serve endpoint's introspection: functions registered, cloud mode, both keys present. */
export async function inngestEndpoint(c: CheckConfig, f: FetchLike, which: "web" | "worker"): Promise<CheckResult> {
  const id = `inngest-${which}`;
  const r = await fetchJson(f, `${which === "web" ? c.webUrl : c.workerUrl}/api/inngest`);
  if (r.status !== 200 || !isObj(r.json)) return result(id, "fail", `GET /api/inngest → ${r.status}`);
  const count = num(r.json, "function_count") ?? 0;
  const mode = str(r.json, "mode") ?? "?";
  const detail = `${count} functions, mode ${mode}, signing key ${r.json.has_signing_key === true ? "yes" : "no"}, event key ${r.json.has_event_key === true ? "yes" : "no"}`;
  if (count < 1) return result(id, "fail", `${detail}: no functions registered`);
  if (mode !== "cloud" && !c.allowDevInngest) return result(id, "fail", `${detail}: production must not run the dev mode (unset INNGEST_DEV)`);
  if (mode === "cloud" && (r.json.has_signing_key !== true || r.json.has_event_key !== true)) return result(id, "fail", `${detail}: set INNGEST_SIGNING_KEY and INNGEST_EVENT_KEY`);
  return result(id, "pass", detail);
}

/** The worker's Stripe endpoint, read with a restricted read-only key: it exists, it is enabled, it receives the six event types. */
export async function stripeWebhook(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  if (!c.stripeKey) return result("stripe-webhook", "skip", "no --stripe-key (a restricted key with webhook endpoints: read)");
  const target = `${c.workerUrl}/webhooks/stripe`;
  const r = await stripeCall(f, c.stripeKey, { method: "GET", path: "/webhook_endpoints", query: [["limit", "100"]] });
  if (!r.ok) return result("stripe-webhook", "fail", `GET /v1/webhook_endpoints → ${r.status ?? "network"} ${r.code}`);
  const endpoints = isObj(r.json) && Array.isArray(r.json.data) ? r.json.data.filter(isObj) : [];
  const endpoint = endpoints.find((e) => str(e, "url") === target);
  if (!endpoint) return result("stripe-webhook", "fail", `no endpoint for ${target} (run pnpm stripe:setup)`);
  const events = Array.isArray(endpoint.enabled_events) ? endpoint.enabled_events.filter((e): e is string => typeof e === "string") : [];
  const missing = events.includes("*") ? [] : BILLING_EVENT_TYPES.filter((t) => !events.includes(t));
  if (str(endpoint, "status") !== "enabled") return result("stripe-webhook", "fail", `${target} is ${str(endpoint, "status") ?? "?"}`);
  if (missing.length > 0) return result("stripe-webhook", "fail", `${target} does not receive ${missing.join(", ")}`);
  return result("stripe-webhook", "pass", `${target} enabled for ${events.length} event types`);
}

/** Every user's inference + sandbox cost over their plan price this month (UTC); at or over the 40 % line is a warning, not a failure. */
export async function usageRatios(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  if (!c.usageKey) return result("usage-ratios", "skip", "no --usage-key (usage rows are owner-only under RLS)");
  const period = localMonth("UTC", c.now);
  const headers = anonHeaders(c.usageKey);
  const usage = await fetchJson(f, `${c.supabaseUrl}/rest/v1/usage?period=eq.${period}&select=user_id,llm_cost_usd,sandbox_minutes`, { headers });
  const plans = await fetchJson(f, `${c.supabaseUrl}/rest/v1/entitlements?select=user_id,price_usd`, { headers });
  if (usage.status !== 200 || plans.status !== 200 || !Array.isArray(usage.json) || !Array.isArray(plans.json)) return result("usage-ratios", "fail", `usage → ${usage.status}, entitlements → ${plans.status}`);
  const price = new Map(plans.json.filter(isObj).map((p) => [str(p, "user_id") ?? "", Number(p.price_usd ?? 0)]));
  const ratios = usage.json.filter(isObj).map((u) => ({ user: (str(u, "user_id") ?? "?").slice(0, 8), ratio: usageRatio({ llmCostUsd: Number(u.llm_cost_usd ?? 0), sandboxMinutes: Number(u.sandbox_minutes ?? 0) }, price.get(str(u, "user_id") ?? "") ?? 0) }));
  const over = ratios.filter((r) => r.ratio >= USAGE_ALERT_RATIO);
  const list = ratios.map((r) => `${r.user}… ${Math.round(r.ratio * 1000) / 10} %`).join(", ") || "no usage yet";
  return result("usage-ratios", over.length > 0 ? "warn" : "pass", `${period}: ${list}`);
}

/** Every check in order; a check that throws (a network error, a timeout) is a failure with its message. */
export async function runChecks(c: CheckConfig, f: FetchLike = (input, init) => fetch(input, init)): Promise<readonly CheckResult[]> {
  const checks: readonly [string, () => Promise<CheckResult>][] = [
    ["web-health", () => webHealth(c, f)],
    ["worker-health", () => workerHealth(c, f)],
    ["anon-companies", () => anonCompanies(c, f)],
    ...BUCKETS.map((b): [string, () => Promise<CheckResult>] => [`storage-${b}`, () => bucketPrivate(c, f, b)]),
    ["pwa-manifest", () => manifest(c, f)],
    ["pwa-service-worker", () => serviceWorker(c, f)],
    ["inngest-web", () => inngestEndpoint(c, f, "web")],
    ["inngest-worker", () => inngestEndpoint(c, f, "worker")],
    ["stripe-webhook", () => stripeWebhook(c, f)],
    ["usage-ratios", () => usageRatios(c, f)],
  ];
  const results: CheckResult[] = [];
  for (const [id, run] of checks) results.push(await run().catch((error: unknown) => result(id, "fail", error instanceof Error ? error.message : String(error))));
  return Object.freeze(results);
}

/* ---------- the command line ---------- */

const trimUrl = (value: string | undefined, name: string): string => {
  const v = (value ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(v)) throw new Error(`${name} must be an http(s) URL`);
  return v;
};

/** Flags first, then the environment; the keys are read from the shell and never printed. */
export function configFrom(argv: readonly string[], env: NodeJS.ProcessEnv, now = new Date()): CheckConfig & { readonly json: boolean } {
  const { values } = parseArgs({
    args: [...argv],
    options: { web: { type: "string" }, worker: { type: "string" }, supabase: { type: "string" }, "anon-key": { type: "string" }, "stripe-key": { type: "string" }, "usage-key": { type: "string" }, json: { type: "boolean" }, "allow-dev-inngest": { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  const anonKey = (values["anon-key"] ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (anonKey.length < 10) throw new Error("--anon-key (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) is required: the public anon key");
  return Object.freeze({
    webUrl: trimUrl(values.web ?? env.NORTH_WEB_URL, "--web"),
    workerUrl: trimUrl(values.worker ?? env.NORTH_WORKER_URL, "--worker"),
    supabaseUrl: trimUrl(values.supabase ?? env.NEXT_PUBLIC_SUPABASE_URL, "--supabase"),
    anonKey,
    stripeKey: (values["stripe-key"] ?? env.STRIPE_READ_KEY ?? "").trim() || null,
    usageKey: (values["usage-key"] ?? env.NORTH_USAGE_READ_KEY ?? "").trim() || null,
    allowDevInngest: values["allow-dev-inngest"] === true,
    json: values.json === true,
    now,
  });
}

export function report(c: CheckConfig, results: readonly CheckResult[], json: boolean): string {
  const ok = results.every((r) => r.status !== "fail");
  if (json) return JSON.stringify({ ok, checkedAt: c.now.toISOString(), web: c.webUrl, worker: c.workerUrl, results }, null, 2);
  const lines = results.map((r) => `${r.status.toUpperCase().padEnd(5)} ${r.id.padEnd(19)} ${r.detail}`);
  return [...lines, "", ok ? "production check: green" : `production check: ${results.filter((r) => r.status === "fail").length} failed`].join("\n");
}

async function main(): Promise<void> {
  const config = configFrom(process.argv.slice(2).filter((a) => a !== "--"), process.env);
  const results = await runChecks(config);
  console.log(report(config, results, config.json));
  process.exitCode = results.some((r) => r.status === "fail") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`production check: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
