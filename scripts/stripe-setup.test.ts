import { describe, expect, it } from "vitest";
import { BILLING_EVENT_TYPES, CREDIT_PACKS, SUBSCRIPTION_PLANS } from "@north/core";
import { applySetup, describePlan, keyMode, setupPlan, type FetchLike } from "./stripe-setup";

/** BIL-1 (ADR 0014): the Stripe objects come from plans.ts, and a second run changes nothing. A fake Stripe, no network. */

const WORKER = "https://north-worker.example";
const KEY = "fake-stripe-test-key";

type Obj = Record<string, unknown>;

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly form: URLSearchParams;
  readonly auth: string | null;
}

const indexed = (form: URLSearchParams, name: string): string[] => [...form.entries()].filter(([k]) => k.startsWith(`${name}[`)).map(([, v]) => v);
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const missing = (): Response => json(404, { error: { code: "resource_missing", message: "No such object" } });

function priceFrom(id: string, form: URLSearchParams): Obj {
  const interval = form.get("recurring[interval]");
  return { id, object: "price", active: true, product: form.get("product"), currency: form.get("currency"), unit_amount: Number(form.get("unit_amount")), lookup_key: form.get("lookup_key"), recurring: interval ? { interval } : null };
}

/** Products, prices (with lookup-key transfer) and webhook endpoints, the way the setup script uses them. */
function fakeStripe(seed: { products?: Obj[]; prices?: Obj[]; endpoints?: Obj[] } = {}) {
  const products = new Map<string, Obj>((seed.products ?? []).map((p) => [String(p.id), p]));
  let prices: Obj[] = [...(seed.prices ?? [])];
  const endpoints: Obj[] = [...(seed.endpoints ?? [])];
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v1/, "");
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    calls.push({ method, path, form, auth: new Headers(init?.headers).get("authorization") });
    const [, kind, id] = path.split("/");
    if (kind === "products" && method === "GET") return id && products.has(id) ? json(200, products.get(id)) : missing();
    if (kind === "products" && method === "POST") {
      const productId = id ?? form.get("id") ?? "prod_fake";
      products.set(productId, { ...(products.get(productId) ?? {}), id: productId, name: form.get("name"), active: true });
      return json(200, products.get(productId));
    }
    if (kind === "prices" && method === "GET") return json(200, { object: "list", data: prices.filter((p) => p.lookup_key === url.searchParams.get("lookup_keys[]") && p.active === true) });
    if (kind === "prices" && method === "POST") {
      const created = priceFrom(`price_fake_${prices.length + 1}`, form);
      prices = [...(form.get("transfer_lookup_key") === "true" ? prices.map((p) => (p.lookup_key === created.lookup_key ? { ...p, lookup_key: null } : p)) : prices), created];
      return json(200, created);
    }
    if (kind === "webhook_endpoints" && method === "GET") return json(200, { object: "list", data: endpoints });
    if (kind === "webhook_endpoints" && method === "POST" && !id) {
      const created = { id: `we_fake_${endpoints.length + 1}`, url: form.get("url"), enabled_events: indexed(form, "enabled_events"), status: "enabled", api_version: form.get("api_version"), secret: "fake-signing-secret" };
      endpoints.push(created);
      return json(200, created);
    }
    if (kind === "webhook_endpoints" && method === "POST" && id) {
      const at = endpoints.findIndex((e) => e.id === id);
      endpoints[at] = { ...endpoints[at], enabled_events: indexed(form, "enabled_events"), status: form.get("disabled") === "false" ? "enabled" : endpoints[at]?.status };
      return json(200, endpoints[at]);
    }
    return missing();
  };
  return { fetchImpl, calls, prices: () => prices, endpoints };
}

describe("stripe:setup (BIL-1)", () => {
  it("plans from plans.ts: a product and a priced lookup key per plan and pack, the webhook for the six event types", () => {
    const plan = setupPlan(`${WORKER}/`);
    expect(plan.products.map((p) => p.id)).toEqual(["north_solo", "north_pro", "north_scale", ...CREDIT_PACKS.map((p) => `north_${p.id}`)]);
    expect(plan.prices.map((p) => [p.lookupKey, p.unitAmount, p.interval])).toEqual([
      [SUBSCRIPTION_PLANS.solo.lookupKey, 9900, "month"],
      [SUBSCRIPTION_PLANS.pro.lookupKey, 29900, "month"],
      [SUBSCRIPTION_PLANS.scale.lookupKey, 99900, "month"],
      ["north_pack_100", 2900, null],
    ]);
    expect(plan.webhook).toMatchObject({ url: `${WORKER}/webhooks/stripe`, events: [...BILLING_EVENT_TYPES] });
    expect(describePlan(plan)).toContain("price north_pack_100: 2900 usd once on north_pack_100");
  });

  it("creates everything on an empty account, with the key as the bearer only and the secret not printed by default", async () => {
    const stripe = fakeStripe();
    const lines = await applySetup(setupPlan(WORKER), KEY, stripe.fetchImpl);
    expect(lines.filter((l) => l.startsWith("created"))).toHaveLength(9);
    expect(lines[lines.length - 1]).toContain("reveal its signing secret in the Stripe dashboard");
    expect(lines.join("\n")).not.toContain("fake-signing-secret");
    expect(stripe.calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    const created = stripe.calls.filter((c) => c.method === "POST" && c.path === "/prices");
    expect(created.map((c) => c.form.get("lookup_key"))).toEqual(["north_solo_monthly", "north_pro_monthly", "north_scale_monthly", "north_pack_100"]);
    expect(created.every((c) => c.form.get("transfer_lookup_key") === "true")).toBe(true);
    expect(created[3]?.form.get("recurring[interval]")).toBeNull();
    expect(stripe.endpoints[0]).toMatchObject({ url: `${WORKER}/webhooks/stripe`, enabled_events: [...BILLING_EVENT_TYPES] });
  });

  it("is idempotent: a second run only reads", async () => {
    const stripe = fakeStripe();
    await applySetup(setupPlan(WORKER), KEY, stripe.fetchImpl);
    const before = stripe.calls.length;
    const again = await applySetup(setupPlan(WORKER), KEY, stripe.fetchImpl);
    expect(again.every((l) => l.startsWith("kept"))).toBe(true);
    expect(stripe.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
  });

  it("a changed price creates a new one and transfers the lookup key; a disabled endpoint is re-enabled with the six events", async () => {
    const stripe = fakeStripe({
      prices: [{ id: "price_old", object: "price", active: true, product: "north_pro", currency: "usd", unit_amount: 24900, lookup_key: "north_pro_monthly", recurring: { interval: "month" } }],
      endpoints: [{ id: "we_old", url: `${WORKER}/webhooks/stripe`, enabled_events: ["invoice.paid"], status: "disabled" }],
    });
    const lines = await applySetup(setupPlan(WORKER), KEY, stripe.fetchImpl, true);
    expect(lines.find((l) => l.includes("north_pro_monthly"))).toMatch(/^replaced price north_pro_monthly \(price_fake_\d+, lookup key transferred\)$/);
    expect(lines.filter((l) => l.startsWith("created price"))).toHaveLength(3);
    expect(stripe.prices().filter((p) => p.lookup_key === "north_pro_monthly").map((p) => p.unit_amount)).toEqual([29900]);
    expect(lines[lines.length - 1]).toBe(`updated webhook ${WORKER}/webhooks/stripe (we_old): 6 events, enabled`);
    expect(stripe.endpoints[0]).toMatchObject({ status: "enabled", enabled_events: [...BILLING_EVENT_TYPES] });
  });

  it("reads only the mode segment of a key", () => {
    expect(keyMode("xx_test_fake")).toBe("test");
    expect(keyMode("xx_live_fake")).toBe("live");
    expect(keyMode("nonsense")).toBe("unknown");
  });
});
