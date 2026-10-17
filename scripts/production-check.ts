/**
 * OPS-1 (ADR 0015): the read-only production check. It reads the live
 * deployment the founder points it at and changes nothing: no write, no
 * service role key. It is the last step of `docs/runbooks/production.md` and
 * the first step of any incident.
 *
 *   web and worker health lines (mode, runtime, webhooks mounted, clock = wall)
 *   the worker's profile, fence, gateway and env for the deployment being checked (STG-1, TST-5):
 *     production = profile production, fence off, env production, no recording or replaying gateway;
 *     staging = fence on, env staging, no replaying gateway; the rules live in production-check-rules.ts
 *   the web health line reports llm "mock": the web never calls the model around the worker's gateway
 *   the public worker mounts no sandbox route: /sandbox/sites/ and /sandbox/clock are 404
 *   an anonymous select on `companies` returns zero rows
 *   both storage buckets refuse an anonymous list and are not public
 *   the manifest and the service worker with the right content types
 *   the Inngest introspection of both serve endpoints (function count, cloud mode, keys)
 *   the Stripe webhook endpoint for the worker exists and is enabled (a restricted read-only key)
 *   every user's usage ratio for the month (only with a key that may read `usage`)
 *
 * Usage:
 *   [STRIPE_READ_KEY=<restricted read-only key>] [NORTH_USAGE_READ_KEY=<key>] [VERCEL_AUTOMATION_BYPASS_SECRET=<secret>] \
 *   pnpm production:check -- --web https://<web> --worker https://<worker> \
 *     --supabase https://<ref>.supabase.co --anon-key <anon key> [--env production|staging] [--json] [--allow-dev-inngest]
 * `pnpm staging:check` is the same command with `--env staging`; every check but the worker's
 * health rules runs unchanged in both. Env fallbacks for the flags: NORTH_WEB_URL, NORTH_WORKER_URL,
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NORTH_CHECK_ENV. The two
 * secret keys and the Vercel bypass secret (a web behind Deployment Protection, STG-1; sent
 * to the web's origin only) are read from the environment only, never from a flag, so they
 * stay out of shell history and `ps` (M6 review L11).
 * Exit 1 when any check fails; `skip` and `warn` do not fail.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BILLING_EVENT_TYPES, USAGE_ALERT_RATIO, usageRatio } from "@north/core";
import { localMonth } from "@north/core/time";
import { stripeCall } from "../packages/integrations/src/live/stripe-http";
import { CHECK_ENVS, failedHealthRules, healthFacts, isCheckEnv, type CheckEnv } from "./production-check-rules";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type CheckStatus = "pass" | "fail" | "skip" | "warn";

export interface CheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface CheckConfig {
  /** STG-1: which deployment the worker's health rules are those of; every other check is the same in both. */
  readonly env: CheckEnv;
  readonly webUrl: string;
  readonly workerUrl: string;
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly stripeKey: string | null;
  readonly usageKey: string | null;
  /** STG-1: the Vercel automation bypass secret for a web behind Deployment Protection (the staging environment); sent to the web's origin only. */
  readonly webBypassSecret?: string | null;
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

/** The web's line: `{ ok, app, time, llm }`. `llm` must read "mock" in both envs: the web never calls the model around the worker's gateway (STG-1, TST-5). */
export async function webHealth(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const r = await fetchJson(f, `${c.webUrl}/api/health`);
  const body = isObj(r.json) ? r.json : null;
  if (r.status !== 200 || body === null || body.ok !== true || (str(body, "app") ?? "north-web") !== "north-web") return result("web-health", "fail", `GET /api/health → ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
  if (body.llm === undefined) return result("web-health", "fail", "GET /api/health has no llm field: the web is older than this check");
  if (body.llm !== "mock") return result("web-health", "fail", `GET /api/health: llm is ${JSON.stringify(body.llm)?.slice(0, 80)}: the web must not call the model (unset AGENT_RUNTIME and ANTHROPIC_API_KEY on the web host)`);
  return result("web-health", "pass", "GET /api/health ok, llm mock");
}

/**
 * The worker's line: `{ ok, mode, runtime, webhooks: { sentry, stripe }, clockIsWall, profile, fence, gateway, env, ... }`.
 * The Stripe webhook must be mounted, the clock must be the wall's, and the env's rules hold (STG-1, TST-5);
 * every problem is named at once.
 */
export async function workerHealth(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const r = await fetchJson(f, `${c.workerUrl}/health`);
  if (r.status !== 200 || !isObj(r.json) || r.json.ok !== true) return result("worker-health", "fail", `GET /health → ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
  const h = r.json;
  const webhooks = isObj(h.webhooks) ? h.webhooks : {};
  const clock = str(h, "clock");
  const time = str(h, "time");
  const clockIsWall = typeof h.clockIsWall === "boolean" ? h.clockIsWall : clock !== null && time !== null && Math.abs(Date.parse(clock) - Date.parse(time)) <= CLOCK_SKEW_MS;
  const detail = `mode ${str(h, "mode") ?? "?"}, runtime ${str(h, "runtime") ?? "?"}, webhooks stripe ${on(webhooks.stripe) ? "on" : "off"}, sentry ${on(webhooks.sentry) ? "on" : "off"}, clock ${clockIsWall ? "= wall" : "simulated"}, ${healthFacts(h)}`;
  const problems = [
    clockIsWall ? null : "the worker clock is not the wall clock (NORTH_CLOCK_START or /sandbox/clock in production)",
    on(webhooks.stripe) ? null : "the Stripe webhook is not mounted (set STRIPE_WEBHOOK_SECRET on Fly)",
    ...failedHealthRules(c.env, h),
  ].filter((problem): problem is string => problem !== null);
  return problems.length === 0 ? result("worker-health", "pass", detail) : result("worker-health", "fail", `${detail}: ${problems.join("; ")}`);
}

/** Paths a sandbox worker on loopback serves; the public worker (bound to 0.0.0.0) must not have them at all (ADR 0015, M6 review L5). */
const SANDBOX_PROBES = ["/sandbox/sites/", "/sandbox/clock"] as const;

/** GETs only: each sandbox path must be 404 (not mounted). A 403 means a guarded sandbox route is mounted, which is still a failure. */
export async function workerSandboxClosed(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  const seen: string[] = [];
  for (const path of SANDBOX_PROBES) {
    const response = await f(`${c.workerUrl}${path}`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.text();
    seen.push(`GET ${path} → ${response.status}`);
  }
  const ok = seen.every((line) => line.endsWith("→ 404"));
  return result("worker-no-sandbox", ok ? "pass" : "fail", ok ? seen.join(", ") : `${seen.join(", ")}: sandbox routes are mounted on the public worker (WORKER_HOST must not be loopback there)`);
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

/**
 * The worker's Stripe endpoint, read with a restricted read-only key: it
 * exists, it is enabled, and it receives every type in core's
 * `BILLING_EVENT_TYPES`, the same list `stripe:setup` registers (no copy here).
 */
export async function stripeWebhook(c: CheckConfig, f: FetchLike): Promise<CheckResult> {
  if (!c.stripeKey) return result("stripe-webhook", "skip", "no STRIPE_READ_KEY in the environment (a restricted key with webhook endpoints: read)");
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
  if (!c.usageKey) return result("usage-ratios", "skip", "no NORTH_USAGE_READ_KEY in the environment (usage rows are owner-only under RLS)");
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

/**
 * STG-1: Vercel answers 401 to a protected deployment (the staging custom
 * environment) unless the request carries the automation bypass secret. With
 * a secret, every request to the web's own origin gets
 * `x-vercel-protection-bypass`; a request to any other origin (the worker,
 * Supabase, Stripe, a look-alike host) never does.
 */
export function withWebBypass(f: FetchLike, webUrl: string, secret: string | null): FetchLike {
  if (!secret) return f;
  const origin = new URL(webUrl).origin;
  return (input, init = {}) => {
    if (new URL(input).origin !== origin) return f(input, init);
    const headers = new Headers(init.headers);
    headers.set("x-vercel-protection-bypass", secret);
    return f(input, { ...init, headers });
  };
}

/** Every check in order; a check that throws (a network error, a timeout) is a failure with its message. */
export async function runChecks(c: CheckConfig, fetchImpl: FetchLike = (input, init) => fetch(input, init)): Promise<readonly CheckResult[]> {
  const f = withWebBypass(fetchImpl, c.webUrl, c.webBypassSecret ?? null);
  const checks: readonly [string, () => Promise<CheckResult>][] = [
    ["web-health", () => webHealth(c, f)],
    ["worker-health", () => workerHealth(c, f)],
    ["worker-no-sandbox", () => workerSandboxClosed(c, f)],
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

/** The secret keys and the only place each is read from (M6 review L11: a flag would put it in shell history and `ps`). */
const KEY_FLAGS: Readonly<Record<string, string>> = Object.freeze({ "--usage-key": "NORTH_USAGE_READ_KEY", "--stripe-key": "STRIPE_READ_KEY", "--bypass-secret": "VERCEL_AUTOMATION_BYPASS_SECRET" });

/** Refuses a key passed as a flag, naming the flag and its variable, never the value. */
function refuseKeyFlags(argv: readonly string[]): void {
  for (const arg of argv) {
    const flag = arg.split("=", 1)[0] ?? "";
    const variable = KEY_FLAGS[flag];
    if (variable) throw new Error(`${flag} is not accepted: a key on the command line lands in shell history and ps; set ${variable} in the environment instead`);
  }
}

/** `--env` over `NORTH_CHECK_ENV` over production; a blank variable is unset, anything but production or staging is a usage error. */
function envFrom(flags: readonly string[] | undefined, env: NodeJS.ProcessEnv): CheckEnv {
  if (flags !== undefined && flags.length > 1) throw new Error(`--env was given ${flags.length} times: pass it once (${CHECK_ENVS.join(" or ")})`);
  const flag = flags?.[0];
  const raw = (flag ?? env.NORTH_CHECK_ENV ?? "").trim();
  if (flag === undefined && raw === "") return "production";
  if (!isCheckEnv(raw)) throw new Error(`${flag === undefined ? "NORTH_CHECK_ENV" : "--env"} ${JSON.stringify(raw.slice(0, 40))} is not known: use ${CHECK_ENVS.join(" or ")}`);
  return raw;
}

/** Flags first, then the environment for the URLs, the anon key and the check env; the secret keys from the environment only, never printed. */
export function configFrom(argv: readonly string[], env: NodeJS.ProcessEnv, now = new Date()): CheckConfig & { readonly json: boolean } {
  refuseKeyFlags(argv);
  const { values } = parseArgs({
    args: [...argv],
    options: { web: { type: "string" }, worker: { type: "string" }, supabase: { type: "string" }, "anon-key": { type: "string" }, env: { type: "string", multiple: true }, json: { type: "boolean" }, "allow-dev-inngest": { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  const anonKey = (values["anon-key"] ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (anonKey.length < 10) throw new Error("--anon-key (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) is required: the public anon key");
  return Object.freeze({
    env: envFrom(values.env, env),
    webUrl: trimUrl(values.web ?? env.NORTH_WEB_URL, "--web"),
    workerUrl: trimUrl(values.worker ?? env.NORTH_WORKER_URL, "--worker"),
    supabaseUrl: trimUrl(values.supabase ?? env.NEXT_PUBLIC_SUPABASE_URL, "--supabase"),
    anonKey,
    stripeKey: (env.STRIPE_READ_KEY ?? "").trim() || null,
    usageKey: (env.NORTH_USAGE_READ_KEY ?? "").trim() || null,
    webBypassSecret: (env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "").trim() || null,
    allowDevInngest: values["allow-dev-inngest"] === true,
    json: values.json === true,
    now,
  });
}

/** The printed report (or, with `json`, the evidence file's JSON): the env checked, every result and the verdict; `ok` unless a check failed. */
export function report(c: CheckConfig, results: readonly CheckResult[], json: boolean): string {
  const ok = results.every((r) => r.status !== "fail");
  if (json) return JSON.stringify({ ok, env: c.env, checkedAt: c.now.toISOString(), web: c.webUrl, worker: c.workerUrl, results }, null, 2);
  const lines = results.map((r) => `${r.status.toUpperCase().padEnd(5)} ${r.id.padEnd(19)} ${r.detail}`);
  return [...lines, "", ok ? `${c.env} check: green` : `${c.env} check: ${results.filter((r) => r.status === "fail").length} failed`].join("\n");
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
