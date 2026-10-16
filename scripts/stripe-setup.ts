/**
 * BIL-1 / BIL-2 (ADR 0014, ADR 0015): creates the platform's Stripe objects
 * from `packages/core/src/billing/plans.ts`, the only source of prices and
 * credits. Idempotent: a second run changes nothing.
 *
 *   one product per plan and pack, with a fixed id (`north_<plan|pack>`)
 *   one active price per lookup key (`north_solo_monthly`, …, `north_pack_100`);
 *     a changed amount creates a new price and transfers the lookup key to it
 *     (existing subscriptions keep their price until Stripe moves them)
 *   the webhook endpoint `<worker>/webhooks/stripe` for the seven event types the
 *     worker projects (core `BILLING_EVENT_TYPES`, `checkout.session.async_payment_succeeded`
 *     included: a pack bought with a delayed method is granted on it, M6 review H1),
 *     pinned to the API version the parser is written against
 *
 * Usage (the founder's shell; test mode first, CLAUDE.md #5):
 *   STRIPE_SECRET_KEY=<your key> pnpm stripe:setup -- --worker-url https://<worker>.fly.dev
 *   pnpm stripe:setup -- --worker-url https://<worker>.fly.dev --dry-run   (prints the plan, calls nothing, needs no key)
 * A live-mode key is refused unless `--live` is passed. A new endpoint's
 * signing secret is shown once with `--print-secret`; otherwise reveal it in
 * the Stripe dashboard and `fly secrets set STRIPE_WEBHOOK_SECRET=…`.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BILLING_EVENT_TYPES, CREDIT_PACKS, SUBSCRIPTION_PLAN_IDS, SUBSCRIPTION_PLANS } from "@north/core";
import { SANDBOX_STRIPE_API_VERSION } from "../packages/integrations/src/sandbox/billing-events";
import { stripeCall, type StripeRequest, type StripeResponse } from "../packages/integrations/src/live/stripe-http";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProductSpec {
  readonly id: string;
  readonly name: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface PriceSpec {
  readonly lookupKey: string;
  readonly product: string;
  readonly unitAmount: number;
  readonly currency: "usd";
  /** `month` for a plan, null for a one-off pack. */
  readonly interval: "month" | null;
  readonly nickname: string;
}

export interface WebhookSpec {
  readonly url: string;
  readonly events: readonly string[];
  readonly apiVersion: string;
}

export interface SetupPlan {
  readonly products: readonly ProductSpec[];
  readonly prices: readonly PriceSpec[];
  readonly webhook: WebhookSpec;
}

/** Everything Stripe must hold, from plans.ts alone (pure). */
export function setupPlan(workerUrl: string): SetupPlan {
  const plans = SUBSCRIPTION_PLAN_IDS.map((id) => SUBSCRIPTION_PLANS[id]);
  const products: ProductSpec[] = [
    ...plans.map((p) => ({ id: `north_${p.id}`, name: `North ${p.name}`, metadata: { north_plan_id: p.id } })),
    ...CREDIT_PACKS.map((p) => ({ id: `north_${p.id}`, name: `North credits (${p.credits})`, metadata: { north_pack_id: p.id } })),
  ];
  const prices: PriceSpec[] = [
    ...plans.map((p) => ({ lookupKey: p.lookupKey, product: `north_${p.id}`, unitAmount: Math.round(p.priceUsd * 100), currency: "usd" as const, interval: "month" as const, nickname: `${p.name}: ${p.companyLimit} ${p.companyLimit === 1 ? "company" : "companies"}, ${p.monthlyCredits} credits a month` })),
    ...CREDIT_PACKS.map((p) => ({ lookupKey: p.lookupKey, product: `north_${p.id}`, unitAmount: Math.round(p.priceUsd * 100), currency: "usd" as const, interval: null, nickname: `${p.credits} credits` })),
  ];
  const webhook = { url: `${workerUrl.replace(/\/+$/, "")}/webhooks/stripe`, events: [...BILLING_EVENT_TYPES], apiVersion: SANDBOX_STRIPE_API_VERSION };
  return Object.freeze({ products: Object.freeze(products), prices: Object.freeze(prices), webhook: Object.freeze(webhook) });
}

export function describePlan(plan: SetupPlan): string {
  return [
    ...plan.products.map((p) => `product ${p.id}: ${p.name}`),
    ...plan.prices.map((p) => `price ${p.lookupKey}: ${p.unitAmount} ${p.currency}${p.interval ? ` per ${p.interval}` : " once"} on ${p.product}`),
    `webhook ${plan.webhook.url}: ${plan.webhook.events.join(", ")} (API ${plan.webhook.apiVersion})`,
  ].join("\n");
}

/* ---------- applying it ---------- */

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (r: StripeResponse): readonly Obj[] => (r.ok && isObj(r.json) && Array.isArray(r.json.data) ? r.json.data.filter(isObj) : []);

export class StripeSetupError extends Error {
  constructor(operation: string, r: Extract<StripeResponse, { ok: false }>) {
    super(`${operation} → ${r.status ?? "network"} ${r.code}`);
    this.name = "StripeSetupError";
  }
}

type Call = (request: StripeRequest) => Promise<StripeResponse>;

async function must(call: Call, request: StripeRequest): Promise<Obj> {
  const r = await call(request);
  if (!r.ok) throw new StripeSetupError(`${request.method} /v1${request.path}`, r);
  return isObj(r.json) ? r.json : {};
}

async function ensureProduct(call: Call, spec: ProductSpec): Promise<string> {
  const found = await call({ method: "GET", path: `/products/${spec.id}` });
  if (found.ok && isObj(found.json)) {
    if (found.json.name === spec.name && found.json.active === true) return `kept product ${spec.id}`;
    await must(call, { method: "POST", path: `/products/${spec.id}`, form: { name: spec.name, active: true, metadata: spec.metadata } });
    return `updated product ${spec.id}`;
  }
  if (found.ok || found.status !== 404) throw new StripeSetupError(`GET /v1/products/${spec.id}`, found.ok ? { ok: false, status: found.status, code: "invalid_response" } : found);
  await must(call, { method: "POST", path: "/products", form: { id: spec.id, name: spec.name, metadata: spec.metadata }, idempotencyKey: `north-setup-product-${spec.id}` });
  return `created product ${spec.id}`;
}

const priceMatches = (p: Obj, spec: PriceSpec): boolean => {
  const recurring = isObj(p.recurring) ? p.recurring : null;
  const product = isObj(p.product) ? p.product.id : p.product;
  return p.active === true && p.unit_amount === spec.unitAmount && p.currency === spec.currency && product === spec.product && (spec.interval === null ? recurring === null : recurring?.interval === spec.interval);
};

async function ensurePrice(call: Call, spec: PriceSpec): Promise<string> {
  const current = list(await call({ method: "GET", path: "/prices", query: [["lookup_keys[]", spec.lookupKey], ["active", "true"], ["limit", "10"]] }));
  const same = current.find((p) => priceMatches(p, spec));
  if (same) return `kept price ${spec.lookupKey} (${String(same.id)})`;
  const form = { product: spec.product, currency: spec.currency, unit_amount: spec.unitAmount, lookup_key: spec.lookupKey, transfer_lookup_key: true, nickname: spec.nickname, ...(spec.interval ? { recurring: { interval: spec.interval } } : {}) };
  const created = await must(call, { method: "POST", path: "/prices", form, idempotencyKey: `north-setup-price-${spec.lookupKey}-${spec.unitAmount}-${spec.interval ?? "once"}` });
  return `${current.length > 0 ? "replaced" : "created"} price ${spec.lookupKey} (${String(created.id)}${current.length > 0 ? ", lookup key transferred" : ""})`;
}

async function ensureWebhook(call: Call, spec: WebhookSpec, printSecret: boolean): Promise<string> {
  const existing = list(await call({ method: "GET", path: "/webhook_endpoints", query: [["limit", "100"]] })).find((e) => e.url === spec.url);
  if (existing) {
    const events = Array.isArray(existing.enabled_events) ? existing.enabled_events : [];
    const same = events.length === spec.events.length && spec.events.every((e) => events.includes(e));
    if (same && existing.status === "enabled") return `kept webhook ${spec.url} (${String(existing.id)})`;
    await must(call, { method: "POST", path: `/webhook_endpoints/${String(existing.id)}`, form: { enabled_events: spec.events, disabled: false } });
    return `updated webhook ${spec.url} (${String(existing.id)}): ${spec.events.length} events, enabled`;
  }
  const created = await must(call, { method: "POST", path: "/webhook_endpoints", form: { url: spec.url, enabled_events: spec.events, api_version: spec.apiVersion, description: "North worker: entitlements are projected from these events (ADR 0014)" } });
  const secret = typeof created.secret === "string" ? created.secret : "";
  const how = printSecret && secret ? `signing secret (shown once): ${secret}` : "reveal its signing secret in the Stripe dashboard";
  return `created webhook ${spec.url} (${String(created.id)}); ${how}, then: fly secrets set STRIPE_WEBHOOK_SECRET=<that secret>`;
}

/** Applies the plan in order (products before prices, the webhook last); returns one line per object. */
export async function applySetup(plan: SetupPlan, key: string, fetchImpl: FetchLike, printSecret = false): Promise<readonly string[]> {
  const call: Call = (request) => stripeCall(fetchImpl, key, request);
  const lines: string[] = [];
  for (const product of plan.products) lines.push(await ensureProduct(call, product));
  for (const price of plan.prices) lines.push(await ensurePrice(call, price));
  lines.push(await ensureWebhook(call, plan.webhook, printSecret));
  return Object.freeze(lines);
}

/** `sk_<mode>_…` / `rk_<mode>_…`: the mode is the second segment; nothing else of the key is read. */
export const keyMode = (key: string): string => key.split("_")[1] ?? "unknown";

async function main(): Promise<void> {
  const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { "worker-url": { type: "string" }, "dry-run": { type: "boolean" }, json: { type: "boolean" }, live: { type: "boolean" }, "print-secret": { type: "boolean" } }, strict: true });
  const worker = (values["worker-url"] ?? process.env.NORTH_WORKER_URL ?? "").trim();
  if (!/^https?:\/\/[^\s/]+/.test(worker)) throw new Error("--worker-url (or NORTH_WORKER_URL) is required: the worker's public URL");
  if (!worker.startsWith("https://") && !values["dry-run"]) throw new Error("Stripe delivers webhooks to https URLs only");
  const plan = setupPlan(worker);
  if (values["dry-run"]) {
    console.log(values.json ? JSON.stringify(plan, null, 2) : `stripe:setup --dry-run (nothing is called)\n${describePlan(plan)}`);
    return;
  }
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is required in the shell (the founder's key, test mode first)");
  if (keyMode(key) !== "test" && !values.live) throw new Error(`refusing a ${keyMode(key)}-mode key without --live (CLAUDE.md #5: test mode first)`);
  const lines = await applySetup(plan, key, (input, init) => fetch(input, init), values["print-secret"] === true);
  console.log(values.json ? JSON.stringify({ mode: keyMode(key), lines }, null, 2) : lines.join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`stripe:setup: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
