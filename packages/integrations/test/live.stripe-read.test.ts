import { describe, expect, it } from "vitest";
import { NotConfiguredError, ProviderError } from "../src/errors";
import type { FetchLike } from "../src/live/github";
import { STRIPE_READ_MAX_OBJECTS, STRIPE_REVENUE_WINDOW_DAYS, StripeReadPayments, monthlyCents, stripeAccountOf } from "../src/live/stripe-read";

const TOKEN = "fake-connected-access-token";
const auth = { token: TOKEN, scope: "acct_1ConnectedAbc" };
const NOW = new Date("2026-11-15T12:00:00.000Z");
const clock = () => NOW;
const WINDOW_START = NOW.getTime() / 1000 - STRIPE_REVENUE_WINDOW_DAYS * 86_400;

interface Call {
  readonly path: string;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string>;
}

/** Scripted fetch over GET routes; each route sees the decoded query and answers a Stripe list page. */
function scripted(routes: Record<string, (query: Record<string, string>) => { status: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const query = Object.fromEntries(parsed.searchParams.entries());
    calls.push({ path: parsed.pathname, query, headers: { ...((init?.headers ?? {}) as Record<string, string>) } });
    const route = routes[parsed.pathname];
    if (!route) return new Response(JSON.stringify({ error: { code: "resource_missing" } }), { status: 404 });
    const { status, json } = route(query);
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, fetchImpl };
}

const page = (data: unknown[], hasMore = false) => ({ object: "list", url: "/v1/x", has_more: hasMore, data });
const price = (unitAmount: number | null, interval: "day" | "week" | "month" | "year", intervalCount = 1, currency = "usd", decimal?: string) => ({
  id: "price_x",
  object: "price",
  currency,
  unit_amount: unitAmount,
  unit_amount_decimal: decimal ?? (unitAmount === null ? null : String(unitAmount)),
  recurring: { interval, interval_count: intervalCount },
});
const subscription = (id: string, customer: string, items: { price: unknown; quantity?: number }[]) => ({
  id,
  object: "subscription",
  customer,
  status: "active",
  items: { object: "list", has_more: false, data: items.map((item, i) => ({ id: `si_${id}_${i}`, object: "subscription_item", quantity: item.quantity ?? 1, price: item.price })) },
});
const charge = (id: string, amount: number, overrides: Record<string, unknown> = {}) => ({ id, object: "charge", amount, amount_refunded: 0, currency: "usd", paid: true, status: "succeeded", refunded: false, created: WINDOW_START + 10, ...overrides });

const SUBSCRIPTIONS = [
  subscription("sub_1", "cus_A", [{ price: price(2900, "month"), quantity: 2 }]),
  subscription("sub_2", "cus_B", [{ price: price(120_000, "year") }]),
  subscription("sub_3", "cus_A", [{ price: price(1000, "week") }]),
  subscription("sub_4", "cus_C", [{ price: price(5000, "month", 1, "eur") }]),
  subscription("sub_5", "cus_D", [{ price: price(9000, "month", 3) }, { price: price(null, "month", 1, "usd", "999.5") }, { price: price(null, "month", 1, "usd", "nope") }]),
];

const CHARGES = [
  charge("ch_1", 2900),
  charge("ch_2", 10_000, { refunded: true, amount_refunded: 10_000 }),
  charge("ch_3", 5000, { amount_refunded: 2000 }),
  charge("ch_4", 4000, { paid: false, status: "failed" }),
  charge("ch_5", 1000, { currency: "eur" }),
  charge("ch_6", 1234),
];

describe("StripeReadPayments (B6-4, OUT-2): the user's own Stripe, read only", () => {
  it("refuses without a connection and calls nothing", async () => {
    const { calls, fetchImpl } = scripted({});
    const read = new StripeReadPayments(null, fetchImpl, clock).read("c1");
    await expect(read).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(read).rejects.toThrow(/not connected/);
    expect(calls).toEqual([]);
  });

  it("reads active subscriptions and the window's charges on the connected account (recorded shapes)", async () => {
    const { calls, fetchImpl } = scripted({ "/v1/subscriptions": () => ({ status: 200, json: page(SUBSCRIPTIONS) }), "/v1/charges": () => ({ status: 200, json: page(CHARGES) }) });
    await expect(new StripeReadPayments(auth, fetchImpl, clock).read("c1")).resolves.toEqual({ payingCustomers: 4, mrrUsd: 241.33, revenueUsd: 71.34, sandbox: false });
    expect(calls.map((c) => [c.path, c.query])).toEqual([
      ["/v1/subscriptions", { status: "active", limit: "100" }],
      ["/v1/charges", { "created[gte]": String(WINDOW_START), limit: "100" }],
    ]);
    expect(calls.every((c) => c.headers.authorization === `Bearer ${TOKEN}` && c.headers["stripe-account"] === "acct_1ConnectedAbc")).toBe(true);
    expect(calls.every((c) => !c.path.includes(TOKEN))).toBe(true);
  });

  it("refunded, failed and non-USD charges are excluded; a partial refund counts net", async () => {
    const { fetchImpl } = scripted({ "/v1/subscriptions": () => ({ status: 200, json: page([]) }), "/v1/charges": () => ({ status: 200, json: page(CHARGES) }) });
    const snapshot = await new StripeReadPayments(auth, fetchImpl, clock).read("c1");
    expect(snapshot.revenueUsd).toBe(29 + 30 + 12.34);
    expect(snapshot).toMatchObject({ payingCustomers: 0, mrrUsd: 0 });
  });

  it("follows has_more with starting_after and stops at 1 000 objects per list", async () => {
    let served = 0;
    const endless = (query: Record<string, string>) => {
      const data = Array.from({ length: 100 }, (_, i) => subscription(`sub_${served + i}`, `cus_${served + i}`, [{ price: price(100, "month") }]));
      expect(query.starting_after).toBe(served === 0 ? undefined : `sub_${served - 1}`);
      served += 100;
      return { status: 200, json: page(data, true) };
    };
    const { calls, fetchImpl } = scripted({ "/v1/subscriptions": endless, "/v1/charges": () => ({ status: 200, json: page([charge("ch_1", 100)], true) }) });
    const snapshot = await new StripeReadPayments(auth, fetchImpl, clock).read("c1");
    expect(STRIPE_READ_MAX_OBJECTS).toBe(1000);
    expect(calls.filter((c) => c.path === "/v1/subscriptions")).toHaveLength(10);
    expect(snapshot).toMatchObject({ payingCustomers: 1000, mrrUsd: 1000 });
    expect(calls.filter((c) => c.path === "/v1/charges").length).toBeLessThanOrEqual(10);
    expect(calls.filter((c) => c.path === "/v1/charges").at(1)?.query.starting_after).toBe("ch_1");
  });

  it("a Stripe error is a ProviderError with the code only, never the token", async () => {
    const { fetchImpl } = scripted({ "/v1/subscriptions": () => ({ status: 401, json: { error: { type: "invalid_request_error", code: "api_key_expired", message: `Expired API Key provided: ${TOKEN}` } } }) });
    const read = new StripeReadPayments(auth, fetchImpl, clock).read("c1");
    await expect(read).rejects.toBeInstanceOf(ProviderError);
    await expect(read).rejects.toThrow("stripe: GET /v1/subscriptions → 401 api_key_expired");
    await expect(read).rejects.not.toThrow(TOKEN);
    const { fetchImpl: malformed } = scripted({ "/v1/subscriptions": () => ({ status: 200, json: { data: "nope" } }) });
    await expect(new StripeReadPayments(auth, malformed, clock).read("c1")).rejects.toThrow(/invalid_response/);
  });

  it("stripeAccountOf takes the connected account id from scope or scopes; monthlyCents normalises intervals", () => {
    expect(stripeAccountOf({ token: "t", scope: "acct_1A" })).toBe("acct_1A");
    expect(stripeAccountOf({ token: "t", scopes: ["read_only", "acct_2B"] })).toBe("acct_2B");
    expect(stripeAccountOf({ token: "t", scope: "acct_../x" })).toBeUndefined();
    expect(stripeAccountOf({ token: "t" })).toBeUndefined();
    expect(monthlyCents({ quantity: 1, price: price(1200, "year") })).toBe(100);
    expect(monthlyCents({ quantity: 1, price: price(1200, "day") })).toBe((1200 * 365) / 12);
    expect(monthlyCents({ quantity: 3, price: price(900, "month", 3) })).toBe(900);
    expect(monthlyCents({ quantity: 1, price: { ...price(1000, "month"), recurring: null } })).toBe(0);
  });

  it("without an account scope no Stripe-Account header is sent (the token is the account's own)", async () => {
    const { calls, fetchImpl } = scripted({ "/v1/subscriptions": () => ({ status: 200, json: page([]) }), "/v1/charges": () => ({ status: 200, json: page([]) }) });
    await expect(new StripeReadPayments({ token: TOKEN }, fetchImpl, clock).read("c1")).resolves.toEqual({ payingCustomers: 0, mrrUsd: 0, revenueUsd: 0, sandbox: false });
    expect(calls.every((c) => !("stripe-account" in c.headers))).toBe(true);
  });
});
