import { describe, expect, it } from "vitest";
import { BillingProviderError } from "../src/errors";
import type { FetchLike } from "../src/live/github";
import { STRIPE_API, StripeBilling, stripeBillingConfig, stripeForm } from "../src/live/stripe-billing";

const KEY = "fake-platform-secret-key";
const config = { secretKey: KEY, webhookSecret: "fake-webhook-secret" };
const USER = "8f14e45f-ceea-467f-a0e6-0e1a2b3c4d5e";

interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly form: Record<string, string>;
  readonly headers: Record<string, string>;
}

type Route = (call: Call) => { status: number; json?: unknown; text?: string };

/** Scripted fetch: answers by `METHOD path`, records the decoded query, form body and headers of every call. */
function scripted(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const method = init?.method ?? "GET";
    const call: Call = {
      method,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams.entries()),
      form: init?.body ? Object.fromEntries(new URLSearchParams(String(init.body)).entries()) : {},
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
    };
    calls.push(call);
    const route = routes[`${method} ${parsed.pathname}`];
    if (!route) return new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing", message: `No such route ${KEY}` } }), { status: 404 });
    const { status, json, text } = route(call);
    return new Response(text ?? JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const list = (data: unknown[], hasMore = false) => ({ object: "list", data, has_more: hasMore, url: "/v1/x" });
const priceRoute: Route = (call) => ({ status: 200, json: list([{ id: `price_for_${call.query["lookup_keys[]"]}`, object: "price", lookup_key: call.query["lookup_keys[]"] }]) });
const sessionRoute: Route = () => ({ status: 200, json: { id: "cs_test_a1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_a1#fid" } });

/** The adapter's clock in these tests: `expires_at` is 35 minutes after it (L10). */
const NOW = new Date("2026-11-02T04:00:00.000Z");
const EXPIRES_AT = String(NOW.getTime() / 1000 + 35 * 60);

const checkout = {
  customerId: "cus_Q1w2e3r4",
  lookupKey: "north_pro_monthly",
  clientReferenceId: USER,
  successUrl: "https://app.north.example/settings/billing?checkout={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://app.north.example/settings/billing",
  idempotencyKey: "7d1c2b3a-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
};

describe("stripeBillingConfig (B6-3): both keys or nothing", () => {
  it("returns the keys only when both are set and not blank", () => {
    expect(stripeBillingConfig({})).toBeNull();
    expect(stripeBillingConfig({ STRIPE_SECRET_KEY: KEY })).toBeNull();
    expect(stripeBillingConfig({ STRIPE_WEBHOOK_SECRET: "whsec_x" })).toBeNull();
    expect(stripeBillingConfig({ STRIPE_SECRET_KEY: "  ", STRIPE_WEBHOOK_SECRET: "whsec_x" })).toBeNull();
    expect(stripeBillingConfig({ STRIPE_SECRET_KEY: ` ${KEY} `, STRIPE_WEBHOOK_SECRET: "whsec_x" })).toEqual({ secretKey: KEY, webhookSecret: "whsec_x" });
  });
});

describe("stripeForm: Stripe's bracket encoding", () => {
  it("flattens objects and arrays, writes booleans as words and skips null and undefined", () => {
    const decoded = Object.fromEntries(new URLSearchParams(stripeForm({ mode: "payment", line_items: [{ price: "price_1", quantity: 1 }], metadata: { a: "x y" }, allow: true, none: null, missing: undefined })).entries());
    expect(decoded).toEqual({ mode: "payment", "line_items[0][price]": "price_1", "line_items[0][quantity]": "1", "metadata[a]": "x y", allow: "true" });
  });
});

describe("StripeBilling live adapter (B6-3, BIL-1): recorded request shapes", () => {
  it("ensureCustomer searches by metadata north_user_id first and returns the hit without creating", async () => {
    const { calls, fetchImpl } = scripted({ "GET /v1/customers/search": () => ({ status: 200, json: { object: "search_result", data: [{ id: "cus_found1", object: "customer" }], has_more: false } }) });
    await expect(new StripeBilling(config, fetchImpl).ensureCustomer({ userId: USER, email: "mara@example.test" })).resolves.toEqual({ customerId: "cus_found1", sandbox: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/customers/search", query: { query: `metadata['north_user_id']:'${USER}'`, limit: "1" } });
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("ensureCustomer creates a tagged customer with an idempotency key when the search finds none", async () => {
    const { calls, fetchImpl } = scripted({
      "GET /v1/customers/search": () => ({ status: 200, json: { object: "search_result", data: [], has_more: false } }),
      "POST /v1/customers": () => ({ status: 200, json: { id: "cus_new1", object: "customer" } }),
    });
    await expect(new StripeBilling(config, fetchImpl).ensureCustomer({ userId: USER, email: "mara@example.test" })).resolves.toEqual({ customerId: "cus_new1", sandbox: false });
    expect(calls[1]).toMatchObject({ method: "POST", path: "/v1/customers", form: { email: "mara@example.test", "metadata[north_user_id]": USER } });
    expect(calls[1]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[1]?.headers["idempotency-key"]).toBe(`north-customer-${USER}`);
  });

  it("createCheckoutSession resolves the price by lookup key and posts a card-only form with the session row id as Idempotency-Key", async () => {
    const { calls, fetchImpl } = scripted({ "GET /v1/prices": priceRoute, "POST /v1/checkout/sessions": sessionRoute });
    const billing = new StripeBilling(config, fetchImpl, () => NOW);
    await expect(billing.createCheckoutSession(checkout)).resolves.toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_a1#fid", providerRef: "cs_test_a1", sandbox: false });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/prices", query: { "lookup_keys[]": "north_pro_monthly", active: "true", limit: "1" } });
    expect(calls[1]).toMatchObject({ method: "POST", path: "/v1/checkout/sessions" });
    expect(calls[1]?.form).toEqual({
      mode: "subscription",
      customer: "cus_Q1w2e3r4",
      "line_items[0][price]": "price_for_north_pro_monthly",
      "line_items[0][quantity]": "1",
      "payment_method_types[0]": "card",
      client_reference_id: USER,
      success_url: checkout.successUrl,
      cancel_url: checkout.cancelUrl,
      allow_promotion_codes: "true",
      expires_at: EXPIRES_AT,
      "metadata[north_user_id]": USER,
      "subscription_data[metadata][north_user_id]": USER,
    });
    expect(calls[1]?.headers["idempotency-key"]).toBe(checkout.idempotencyKey);
    expect(calls.every((c) => c.headers.authorization === `Bearer ${KEY}`)).toBe(true);
  });

  it("caches a resolved price per lookup key for the life of the adapter", async () => {
    const { calls, fetchImpl } = scripted({ "GET /v1/prices": priceRoute, "POST /v1/checkout/sessions": sessionRoute });
    const billing = new StripeBilling(config, fetchImpl);
    await billing.createCheckoutSession(checkout);
    await billing.createCheckoutSession({ ...checkout, idempotencyKey: "second" });
    await billing.createCheckoutSession({ ...checkout, lookupKey: "north_solo_monthly", idempotencyKey: "third" });
    expect(calls.filter((c) => c.path === "/v1/prices").map((c) => c.query["lookup_keys[]"])).toEqual(["north_pro_monthly", "north_solo_monthly"]);
  });

  it("an unknown lookup key in Stripe is a BillingProviderError and is not cached", async () => {
    const { calls, fetchImpl } = scripted({ "GET /v1/prices": () => ({ status: 200, json: list([]) }), "POST /v1/checkout/sessions": sessionRoute });
    const billing = new StripeBilling(config, fetchImpl);
    await expect(billing.createCheckoutSession(checkout)).rejects.toMatchObject({ code: "lookup_key_not_found", status: 404 });
    await expect(billing.createCheckoutSession(checkout)).rejects.toBeInstanceOf(BillingProviderError);
    expect(calls.filter((c) => c.path === "/v1/prices")).toHaveLength(2);
    expect(calls.some((c) => c.path === "/v1/checkout/sessions")).toBe(false);
  });

  it("createCreditPackSession is a card-only payment checkout at the pack's exact price, tagged with metadata north_pack_id (H1)", async () => {
    const { calls, fetchImpl } = scripted({ "GET /v1/prices": priceRoute, "POST /v1/checkout/sessions": sessionRoute });
    const { customerId, clientReferenceId, successUrl, cancelUrl } = checkout;
    await new StripeBilling(config, fetchImpl, () => NOW).createCreditPackSession({ customerId, clientReferenceId, successUrl, cancelUrl, packId: "pack_100", idempotencyKey: "pack-session-1" });
    expect(calls[0]?.query["lookup_keys[]"]).toBe("north_pack_100");
    expect(calls[1]?.form).toEqual({
      mode: "payment",
      customer: "cus_Q1w2e3r4",
      "line_items[0][price]": "price_for_north_pack_100",
      "line_items[0][quantity]": "1",
      "payment_method_types[0]": "card",
      client_reference_id: USER,
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_at: EXPIRES_AT,
      "metadata[north_user_id]": USER,
      "metadata[north_pack_id]": "pack_100",
    });
    expect(calls[1]?.form).not.toHaveProperty("subscription_data[metadata][north_user_id]");
    expect(calls[1]?.form).not.toHaveProperty("allow_promotion_codes");
    expect(calls[1]?.headers["idempotency-key"]).toBe("pack-session-1");
  });

  it("createPortalSession posts the customer and return URL", async () => {
    const { calls, fetchImpl } = scripted({ "POST /v1/billing_portal/sessions": () => ({ status: 200, json: { id: "bps_1x", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/test_1x" } }) });
    await expect(new StripeBilling(config, fetchImpl).createPortalSession({ customerId: "cus_Q1w2e3r4", returnUrl: "https://app.north.example/settings/billing", idempotencyKey: "portal-row-1" })).resolves.toEqual({ url: "https://billing.stripe.com/p/session/test_1x", providerRef: "bps_1x", sandbox: false });
    expect(calls[0]?.form).toEqual({ customer: "cus_Q1w2e3r4", return_url: "https://app.north.example/settings/billing" });
    expect(calls[0]?.headers["idempotency-key"]).toBe("portal-row-1");
  });

  it("subscription reads the customer's latest subscription across both API shapes, null when there is none", async () => {
    const legacy = { id: "sub_1", status: "active", cancel_at_period_end: true, current_period_end: 1_798_000_000, items: { data: [{ price: { lookup_key: "north_pro_monthly" } }] } };
    const basil = { id: "sub_2", status: "past_due", items: { data: [{ price: { lookup_key: null }, current_period_end: 1_799_000_000 }] } };
    const answers = [list([legacy]), list([basil]), list([])];
    const { calls, fetchImpl } = scripted({ "GET /v1/subscriptions": () => ({ status: 200, json: answers.shift() }) });
    const billing = new StripeBilling(config, fetchImpl);
    await expect(billing.subscription("cus_Q1w2e3r4")).resolves.toEqual({ id: "sub_1", status: "active", lookupKey: "north_pro_monthly", periodEnd: new Date(1_798_000_000_000).toISOString(), cancelAtPeriodEnd: true, sandbox: false });
    await expect(billing.subscription("cus_Q1w2e3r4")).resolves.toEqual({ id: "sub_2", status: "past_due", lookupKey: null, periodEnd: new Date(1_799_000_000_000).toISOString(), cancelAtPeriodEnd: false, sandbox: false });
    await expect(billing.subscription("cus_Q1w2e3r4")).resolves.toBeNull();
    expect(calls[0]?.query).toEqual({ customer: "cus_Q1w2e3r4", status: "all", limit: "1" });
    await expect(billing.subscription("../cus")).resolves.toBeNull();
    expect(calls).toHaveLength(3);
  });

  it("subscription(customer, id) reads that subscription (M1 reconcile): canceled is reported, another customer's or a missing one is null", async () => {
    const canceled = { id: "sub_9", customer: "cus_Q1w2e3r4", status: "canceled", cancel_at_period_end: false, items: { data: [{ price: { lookup_key: "north_pro_monthly" }, current_period_end: 1_799_000_000 }] } };
    const answers: { status: number; json: unknown }[] = [
      { status: 200, json: canceled },
      { status: 200, json: { ...canceled, customer: "cus_other1" } },
      { status: 404, json: { error: { type: "invalid_request_error", code: "resource_missing" } } },
      { status: 500, json: { error: { type: "api_error" } } },
    ];
    const { calls, fetchImpl } = scripted({ "GET /v1/subscriptions/sub_9": () => answers.shift()! });
    const billing = new StripeBilling(config, fetchImpl);
    await expect(billing.subscription("cus_Q1w2e3r4", "sub_9")).resolves.toEqual({ id: "sub_9", status: "canceled", lookupKey: "north_pro_monthly", periodEnd: new Date(1_799_000_000_000).toISOString(), cancelAtPeriodEnd: false, sandbox: false });
    await expect(billing.subscription("cus_Q1w2e3r4", "sub_9")).resolves.toBeNull();
    await expect(billing.subscription("cus_Q1w2e3r4", "sub_9")).resolves.toBeNull();
    await expect(billing.subscription("cus_Q1w2e3r4", "sub_9")).rejects.toMatchObject({ code: "http_500" });
    await expect(billing.subscription("cus_Q1w2e3r4", "../sub_9")).resolves.toBeNull();
    expect(calls.map((c) => c.path)).toEqual(Array(4).fill("/v1/subscriptions/sub_9"));
  });
});

describe("StripeBilling errors (B6-3): the Stripe error.code, never the body or the key", () => {
  it("a 402 becomes BillingProviderError('card_declined')", async () => {
    const { fetchImpl } = scripted({
      "GET /v1/prices": priceRoute,
      "POST /v1/checkout/sessions": () => ({ status: 402, json: { error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: `Your card was declined. ${KEY} mara@example.test` } } }),
    });
    const failure = new StripeBilling(config, fetchImpl).createCheckoutSession(checkout);
    await expect(failure).rejects.toBeInstanceOf(BillingProviderError);
    await expect(failure).rejects.toMatchObject({ code: "card_declined", status: 402, message: "stripe: POST /v1/checkout/sessions → 402 card_declined" });
    await expect(failure).rejects.not.toThrow(/declined\.|sk_test|mara@/);
  });

  it("a 5xx without a code, a non-JSON body, a malformed success and a network failure map to fixed codes", async () => {
    const run = async (route: Route | null) => {
      const fetchImpl: FetchLike = route
        ? scripted({ "POST /v1/billing_portal/sessions": route }).fetchImpl
        : async () => {
            throw new Error(`connect ECONNREFUSED with ${KEY}`);
          };
      return new StripeBilling(config, fetchImpl).createPortalSession({ customerId: "cus_1", returnUrl: "https://app.example/b" }).catch((e: unknown) => e);
    };
    await expect(run(() => ({ status: 500, json: { error: { type: "api_error", message: "boom" } } }))).resolves.toMatchObject({ code: "http_500", status: 500 });
    await expect(run(() => ({ status: 400, text: "<html>bad gateway</html>" }))).resolves.toMatchObject({ code: "http_400" });
    await expect(run(() => ({ status: 400, json: { error: { code: "Weird Code!" } } }))).resolves.toMatchObject({ code: "http_400" });
    await expect(run(() => ({ status: 200, json: { id: "bps_1", url: "http://not-https.example/" } }))).resolves.toMatchObject({ code: "invalid_response" });
    await expect(run(() => ({ status: 200, text: "not json" }))).resolves.toMatchObject({ code: "invalid_response" });
    const network = await run(null);
    expect(network).toMatchObject({ code: "network_error", status: null });
    expect(String((network as Error).message)).not.toContain(KEY);
  });

  it("validates every input before any request", async () => {
    const { calls, fetchImpl } = scripted({});
    const billing = new StripeBilling(config, fetchImpl);
    await expect(billing.createCheckoutSession({ ...checkout, lookupKey: "north_enterprise" })).rejects.toThrow();
    await expect(billing.createCheckoutSession({ ...checkout, successUrl: "http://evil.example/" })).rejects.toThrow();
    await expect(billing.ensureCustomer({ userId: "' OR 1=1", email: "a@example.test" })).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(STRIPE_API).toBe("https://api.stripe.com/v1");
  });
});
