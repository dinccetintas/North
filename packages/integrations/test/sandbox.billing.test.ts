import { createHmac } from "node:crypto";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BILLING_EVENT_TYPES, applyBillingEvent, creditGrantsFor, parseBillingEvent, trialEntitlement, type BillingEvent, type Entitlement } from "@north/core";
import { BillingProviderError } from "../src/errors";
import { SANDBOX_STRIPE_WEBHOOK_SECRET, SandboxBilling, isSandboxBilling, signSandboxWebhook, signedSandboxEvent, type SandboxStripeEvent } from "../src/sandbox/billing";
import { createSandboxIntegrations } from "../src/sandbox/index";
import type { SandboxEvent } from "../src/types";

const USER = "8f14e45f-ceea-467f-a0e6-0e1a2b3c4d5e";
const OTHER = "1c6f0a52-9d3e-4b7a-8e21-5f4d3c2b1a09";
const BASE = "http://127.0.0.1:3101";
const START = new Date("2026-11-02T04:00:00.000Z");
const START_UNIX = START.getTime() / 1000;
const DEC_2 = Date.UTC(2026, 11, 2, 4) / 1000;
const JAN_2 = Date.UTC(2027, 0, 2, 4) / 1000;

const root = () => mkdtemp(join(tmpdir(), "north-billing-"));

/** A movable clock so tests can advance time between simulated clicks. */
function movable(start: Date) {
  let now = start;
  return { clock: () => now, set: (next: Date) => void (now = next) };
}

async function setup(dir?: string) {
  const path = dir ?? (await root());
  const events: SandboxEvent[] = [];
  const time = movable(START);
  const billing = new SandboxBilling((e) => void events.push(e), path, time.clock, { siteBaseUrl: BASE });
  const { customerId } = await billing.ensureCustomer({ userId: USER, email: "mara@example.test" });
  return { path, events, time, billing, customerId };
}

const checkoutInput = (customerId: string, overrides: Record<string, unknown> = {}) => ({
  customerId,
  lookupKey: "north_pro_monthly",
  clientReferenceId: USER,
  successUrl: "http://localhost:3100/settings/billing?checkout=s1",
  cancelUrl: "http://localhost:3100/settings/billing",
  idempotencyKey: "b7e6f1d2-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  ...overrides,
});

const parsed = (event: SandboxStripeEvent): BillingEvent => {
  const result = parseBillingEvent(JSON.parse(JSON.stringify(event)));
  if ("ignored" in result) throw new Error(`sandbox emitted an ignored event: ${result.ignored}`);
  return result;
};

const objectOf = (event: SandboxStripeEvent) => event.data.object as Record<string, unknown> & { items?: { data: { current_period_start: number; current_period_end: number; price: { lookup_key: string } }[] }; lines?: { data: { period: { start: number; end: number } }[] } };

describe("SandboxBilling customers and sessions (B6-2, BIL-1)", () => {
  it("ensureCustomer is idempotent per user, files the customer under billing/customers and never sends the email to the sink", async () => {
    const { path, events, billing, customerId } = await setup();
    expect(customerId).toBe("cus_sandbox_1");
    await expect(billing.ensureCustomer({ userId: USER, email: "mara@example.test" })).resolves.toEqual({ customerId, sandbox: true });
    await expect(billing.ensureCustomer({ userId: OTHER, email: "eli@example.test" })).resolves.toEqual({ customerId: "cus_sandbox_2", sandbox: true });
    const stored = JSON.parse(await readFile(join(path, "billing", "customers", `${customerId}.json`), "utf8"));
    expect(stored).toMatchObject({ id: customerId, userId: USER, email: "mara@example.test" });
    expect(events.map((e) => [e.provider, e.op, e.payload.created])).toEqual([
      ["billing", "ensureCustomer", true],
      ["billing", "ensureCustomer", false],
      ["billing", "ensureCustomer", true],
    ]);
    expect(JSON.stringify(events)).not.toContain("mara@example.test");
    await expect(billing.ensureCustomer({ userId: "not-a-uuid", email: "x@example.test" })).rejects.toThrow();
  });

  it("a checkout session is a page on the worker, idempotent per key, filed under billing/sessions", async () => {
    const { path, billing, customerId } = await setup();
    const session = await billing.createCheckoutSession(checkoutInput(customerId));
    expect(session).toEqual({ url: `${BASE}/sandbox/billing/checkout/cs_sandbox_1`, providerRef: "cs_sandbox_1", sandbox: true });
    await expect(billing.createCheckoutSession(checkoutInput(customerId))).resolves.toEqual(session);
    await access(join(path, "billing", "sessions", "cs_sandbox_1.json"));
    expect(await billing.checkoutSession("cs_sandbox_1")).toMatchObject({ id: "cs_sandbox_1", customerId, mode: "subscription", lookupKey: "north_pro_monthly", status: "open", packId: null });
    expect(await billing.checkoutSession("cs_sandbox_404")).toBeNull();
    expect(await billing.checkoutSession("../../etc/passwd")).toBeNull();
    const other = await billing.createCheckoutSession(checkoutInput(customerId, { idempotencyKey: "second-key" }));
    expect(other.providerRef).toBe("cs_sandbox_2");
  });

  it("refuses an unknown customer, a lookup key North does not sell and a foreign return URL", async () => {
    const { billing, customerId } = await setup();
    const unknown = billing.createCheckoutSession(checkoutInput("cus_sandbox_99"));
    await expect(unknown).rejects.toBeInstanceOf(BillingProviderError);
    await expect(unknown).rejects.toMatchObject({ code: "resource_missing", status: 404 });
    await expect(billing.createCheckoutSession(checkoutInput(customerId, { lookupKey: "north_free" }))).rejects.toThrow(/lookup key/);
    await expect(billing.createCheckoutSession(checkoutInput(customerId, { successUrl: "http://evil.example/" }))).rejects.toThrow(/https/);
  });

  it("the portal is a page per customer on the worker; an unknown customer is refused", async () => {
    const { billing, customerId } = await setup();
    const portal = await billing.createPortalSession({ customerId, returnUrl: "http://localhost:3100/settings/billing", idempotencyKey: "portal-1" });
    expect(portal).toEqual({ url: `${BASE}/sandbox/billing/portal/${customerId}`, providerRef: "bps_sandbox_1", sandbox: true });
    await expect(billing.createPortalSession({ customerId, returnUrl: "http://localhost:3100/settings/billing", idempotencyKey: "portal-1" })).resolves.toEqual(portal);
    expect((await billing.createPortalSession({ customerId, returnUrl: "https://app.example/b" })).providerRef).toBe("bps_sandbox_2");
    await expect(billing.createPortalSession({ customerId: "cus_sandbox_99", returnUrl: "https://app.example/b" })).rejects.toMatchObject({ code: "resource_missing" });
  });
});

describe("SandboxBilling simulation (B6-2): Stripe-shaped events in Stripe's order", () => {
  it("completeCheckout → checkout.session.completed, customer.subscription.created, invoice.paid with one customer and one subscription", async () => {
    const { billing, customerId } = await setup();
    const { providerRef } = await billing.createCheckoutSession(checkoutInput(customerId));
    const events = await billing.completeCheckout(providerRef);
    expect(events.map((e) => e.type)).toEqual(["checkout.session.completed", "customer.subscription.created", "invoice.paid"]);
    expect(events.map((e) => e.id)).toEqual(["evt_sandbox_1", "evt_sandbox_2", "evt_sandbox_3"]);
    const [checkout, created, paid] = events.map(parsed);
    expect(new Set(events.map((e) => objectOf(e).customer))).toEqual(new Set([customerId]));
    expect(checkout).toMatchObject({ type: "checkout.session.completed", created: START_UNIX, data: { object: { id: providerRef, mode: "subscription", client_reference_id: USER, subscription: "sub_sandbox_1" } } });
    expect(created).toMatchObject({ data: { object: { id: "sub_sandbox_1", status: "active", cancel_at_period_end: false, metadata: { north_user_id: USER } } } });
    expect(objectOf(events[1]!).items?.data[0]).toMatchObject({ price: { lookup_key: "north_pro_monthly" }, current_period_start: START_UNIX, current_period_end: DEC_2 });
    expect(paid).toMatchObject({ data: { object: { amount_paid: 29_900, parent: { subscription_details: { subscription: "sub_sandbox_1" } } } } });
    expect(objectOf(events[2]!).lines?.data[0]?.period).toEqual({ start: START_UNIX, end: DEC_2 });
    expect(events.every((e) => e.object === "event" && e.livemode === false)).toBe(true);
    await expect(billing.subscription(customerId)).resolves.toEqual({ id: "sub_sandbox_1", status: "active", lookupKey: "north_pro_monthly", periodEnd: new Date(DEC_2 * 1000).toISOString(), cancelAtPeriodEnd: false, sandbox: true });
    expect(await billing.checkoutSession(providerRef)).toMatchObject({ status: "complete", subscriptionId: "sub_sandbox_1" });
  });

  it("ids are stable: completing the same session again returns the same events, and a new instance on the root continues the counter", async () => {
    const { path, billing, customerId, time } = await setup();
    const { providerRef } = await billing.createCheckoutSession(checkoutInput(customerId));
    const first = await billing.completeCheckout(providerRef);
    time.set(new Date(START.getTime() + 60_000));
    expect(await billing.completeCheckout(providerRef)).toEqual(first);
    const restarted = new SandboxBilling(undefined, path, time.clock, { siteBaseUrl: BASE });
    expect(await restarted.completeCheckout(providerRef)).toEqual(first);
    const [cancel] = await restarted.cancelAtPeriodEnd(customerId);
    expect(cancel?.id).toBe("evt_sandbox_4");
    expect(cancel?.created).toBe(START_UNIX + 60);
  });

  it("advancePeriod moves the period by one month and pays it (invoice.paid, billing_reason subscription_cycle)", async () => {
    const { billing, customerId } = await setup();
    await billing.completeCheckout((await billing.createCheckoutSession(checkoutInput(customerId))).providerRef);
    const [renewal] = await billing.advancePeriod(customerId);
    expect(renewal?.type).toBe("invoice.paid");
    expect(objectOf(renewal!)).toMatchObject({ billing_reason: "subscription_cycle", amount_paid: 29_900, status: "paid" });
    expect(objectOf(renewal!).lines?.data[0]?.period).toEqual({ start: DEC_2, end: JAN_2 });
    expect((await billing.subscription(customerId))?.periodEnd).toBe(new Date(JAN_2 * 1000).toISOString());
    const [again] = await billing.advancePeriod(customerId);
    expect(objectOf(again!).lines?.data[0]?.period.start).toBe(JAN_2);
    expect(again?.id).not.toBe(renewal?.id);
  });

  it("cancelAtPeriodEnd → subscription.updated (idempotent), then endNow → subscription.deleted (idempotent); an ended subscription cannot advance", async () => {
    const { billing, customerId } = await setup();
    await billing.completeCheckout((await billing.createCheckoutSession(checkoutInput(customerId))).providerRef);
    const cancel = await billing.cancelAtPeriodEnd(customerId);
    expect(cancel.map((e) => e.type)).toEqual(["customer.subscription.updated"]);
    expect(parsed(cancel[0]!)).toMatchObject({ data: { object: { status: "active", cancel_at_period_end: true, cancel_at: DEC_2 } } });
    expect(cancel[0]?.data.previous_attributes).toEqual({ cancel_at_period_end: false, cancel_at: null, canceled_at: null });
    expect(await billing.cancelAtPeriodEnd(customerId)).toEqual(cancel);
    expect((await billing.subscription(customerId))?.cancelAtPeriodEnd).toBe(true);

    const end = await billing.endNow(customerId);
    expect(end.map((e) => e.type)).toEqual(["customer.subscription.deleted"]);
    expect(parsed(end[0]!)).toMatchObject({ data: { object: { id: "sub_sandbox_1", status: "canceled" } } });
    expect(await billing.endNow(customerId)).toEqual(end);
    expect((await billing.subscription(customerId))?.status).toBe("canceled");
    await expect(billing.advancePeriod(customerId)).rejects.toMatchObject({ code: "subscription_canceled" });
    await expect(billing.cancelAtPeriodEnd(customerId)).rejects.toMatchObject({ code: "subscription_canceled" });
    await expect(billing.failPayment(customerId)).rejects.toMatchObject({ code: "subscription_canceled" });
  });

  it("advancing a subscription set to cancel at period end ends it at that period end", async () => {
    const { billing, customerId } = await setup();
    await billing.completeCheckout((await billing.createCheckoutSession(checkoutInput(customerId))).providerRef);
    await billing.cancelAtPeriodEnd(customerId);
    const [ended] = await billing.advancePeriod(customerId);
    expect(ended?.type).toBe("customer.subscription.deleted");
    expect(objectOf(ended!)).toMatchObject({ status: "canceled", ended_at: DEC_2 });
  });

  it("failPayment → invoice.payment_failed for the next period (past_due, idempotent); the next advance pays the same invoice", async () => {
    const { billing, customerId } = await setup();
    await billing.completeCheckout((await billing.createCheckoutSession(checkoutInput(customerId))).providerRef);
    const [failed] = await billing.failPayment(customerId);
    expect(failed?.type).toBe("invoice.payment_failed");
    expect(objectOf(failed!)).toMatchObject({ status: "open", amount_paid: 0, amount_due: 29_900, attempt_count: 1 });
    expect(objectOf(failed!).lines?.data[0]?.period).toEqual({ start: DEC_2, end: JAN_2 });
    expect(await billing.failPayment(customerId)).toEqual([failed]);
    expect((await billing.subscription(customerId))?.status).toBe("past_due");
    const [paid] = await billing.advancePeriod(customerId);
    expect(objectOf(paid!)).toMatchObject({ id: objectOf(failed!).id, status: "paid", amount_paid: 29_900, attempt_count: 2 });
    expect((await billing.subscription(customerId))?.status).toBe("active");
  });

  it("a credit pack checkout is one payment-mode checkout.session.completed tagged with the pack", async () => {
    const { billing, customerId } = await setup();
    const session = await billing.createCreditPackSession({ customerId, packId: "pack_100", clientReferenceId: USER, successUrl: "https://app.example/ok", cancelUrl: "https://app.example/no", idempotencyKey: "pack-1" });
    const events = await billing.completeCheckout(session.providerRef);
    expect(events.map((e) => e.type)).toEqual(["checkout.session.completed"]);
    const event = parsed(events[0]!);
    expect(event).toMatchObject({ data: { object: { id: session.providerRef, mode: "payment", subscription: null, metadata: { north_user_id: USER, north_pack_id: "pack_100" } } } });
    expect(objectOf(events[0]!)).toMatchObject({ amount_total: 2_900, payment_status: "paid" });
    await expect(billing.subscription(customerId)).resolves.toBeNull();
  });

  it("refuses simulations on unknown or malformed ids", async () => {
    const { billing } = await setup();
    await expect(billing.completeCheckout("cs_sandbox_404")).rejects.toMatchObject({ code: "resource_missing" });
    await expect(billing.completeCheckout("../../billing/counter")).rejects.toMatchObject({ code: "resource_missing" });
    await expect(billing.endNow("cus_sandbox_1")).rejects.toMatchObject({ code: "resource_missing" });
    await expect(billing.advancePeriod("../x")).rejects.toMatchObject({ code: "resource_missing" });
    await expect(billing.subscription("../x")).resolves.toBeNull();
  });

  it("never emits an event older than one it already emitted, even when the clock moves back", async () => {
    const { billing, customerId, time } = await setup();
    await billing.completeCheckout((await billing.createCheckoutSession(checkoutInput(customerId))).providerRef);
    time.set(new Date(START.getTime() - 3_600_000));
    const [cancel] = await billing.cancelAtPeriodEnd(customerId);
    expect(cancel?.created).toBe(START_UNIX);
  });

  it("concurrent customers for the same user collapse into one", async () => {
    const dir = await root();
    const billing = new SandboxBilling(undefined, dir, () => START, { siteBaseUrl: BASE });
    const results = await Promise.all([1, 2, 3].map(() => billing.ensureCustomer({ userId: OTHER, email: "eli@example.test" })));
    expect(new Set(results.map((r) => r.customerId))).toEqual(new Set(["cus_sandbox_1"]));
  });
});

describe("Every sandbox event is a BillingEvent the core projection reads (B6-2 × core billing/events)", () => {
  it("a whole lifecycle parses through parseBillingEvent and drives trial → pro active → canceled → ended → solo active", async () => {
    const { billing, customerId, time } = await setup();
    const emitted: SandboxStripeEvent[] = [];
    const later = (minutes: number) => time.set(new Date(START.getTime() + minutes * 60_000));
    emitted.push(...(await billing.completeCheckout((await billing.createCheckoutSession(checkoutInput(customerId))).providerRef)));
    later(1);
    const pack = await billing.createCreditPackSession({ customerId, packId: "pack_100", clientReferenceId: USER, successUrl: "https://app.example/ok", cancelUrl: "https://app.example/no", idempotencyKey: "pack-1" });
    emitted.push(...(await billing.completeCheckout(pack.providerRef)));
    later(2);
    emitted.push(...(await billing.failPayment(customerId)), ...(await billing.advancePeriod(customerId)));
    later(3);
    emitted.push(...(await billing.cancelAtPeriodEnd(customerId)), ...(await billing.endNow(customerId)));
    later(4);
    const solo = await billing.createCheckoutSession(checkoutInput(customerId, { lookupKey: "north_solo_monthly", idempotencyKey: "solo-1" }));
    emitted.push(...(await billing.completeCheckout(solo.providerRef)), ...(await billing.advancePeriod(customerId)));

    const events = emitted.map(parsed);
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(BILLING_EVENT_TYPES));
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);

    let entitlement: Entitlement = trialEntitlement(USER, START);
    const statuses: string[] = [];
    const grants: string[] = [];
    for (const event of events) {
      entitlement = applyBillingEvent(entitlement, event, time.clock());
      if (statuses.at(-1) !== entitlement.status) statuses.push(entitlement.status);
      grants.push(...creditGrantsFor(event, entitlement).map((g) => `${g.kind}:${g.amount}:${g.ref.split(":")[0]}`));
    }
    expect(statuses).toEqual(["trialing", "active", "past_due", "active", "canceled", "ended", "active"]);
    expect(entitlement).toMatchObject({ planId: "solo", companyLimit: 1, stripeCustomerId: customerId, stripeSubscriptionId: "sub_sandbox_2" });
    expect(grants).toEqual(["grant_plan:1000:plan", "grant_pack:100:pack", "grant_plan:1000:plan", "grant_plan:300:plan", "grant_plan:300:plan"]);
  });
});

describe("signSandboxWebhook (B6-2): Stripe's own signature scheme", () => {
  it("builds t=<unix>,v1=<hex HMAC-SHA256 of '<t>.<body>'> with the endpoint secret", () => {
    const body = JSON.stringify({ id: "evt_sandbox_1", type: "invoice.paid" });
    const header = signSandboxWebhook(body, "whsec_sandbox", new Date("2026-11-02T04:00:00.900Z"));
    const expected = createHmac("sha256", "whsec_sandbox").update(`${START_UNIX}.${body}`).digest("hex");
    expect(header).toBe(`t=${START_UNIX},v1=${expected}`);
    expect(signSandboxWebhook(`${body} `, "whsec_sandbox", START)).not.toBe(header);
    expect(signSandboxWebhook(body, "whsec_other", START)).not.toBe(header);
    expect(SANDBOX_STRIPE_WEBHOOK_SECRET).toBe("whsec_sandbox");
  });

  it("signedSandboxEvent serialises the event once and signs exactly those bytes", async () => {
    const { billing, customerId } = await setup();
    const [event] = await billing.completeCheckout((await billing.createCheckoutSession(checkoutInput(customerId))).providerRef);
    const delivery = signedSandboxEvent(event!, SANDBOX_STRIPE_WEBHOOK_SECRET, START);
    expect(JSON.parse(delivery.body)).toEqual(event);
    expect(delivery.signature).toBe(signSandboxWebhook(delivery.body, SANDBOX_STRIPE_WEBHOOK_SECRET, START));
    expect(delivery.eventId).toBe(event!.id);
  });
});

describe("createSandboxIntegrations wiring (B6-2)", () => {
  it("billing is one platform SandboxBilling, exposed on the simulation surface too", async () => {
    const dir = await root();
    const integrations = createSandboxIntegrations(undefined, { root: dir, siteBaseUrl: BASE, clock: () => START });
    expect(integrations.billing).toBeInstanceOf(SandboxBilling);
    expect(integrations.billing).toBe(integrations.sandbox.billing);
    expect(isSandboxBilling(integrations.billing)).toBe(true);
    expect(isSandboxBilling({ ensureCustomer: async () => ({ customerId: "cus_1", sandbox: false }) } as never)).toBe(false);
    const { customerId } = await integrations.billing.ensureCustomer({ userId: USER, email: "mara@example.test" });
    const session = await integrations.billing.createCheckoutSession(checkoutInput(customerId));
    expect(session.url.startsWith(`${BASE}/sandbox/billing/checkout/`)).toBe(true);
  });
});
