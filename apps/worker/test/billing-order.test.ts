import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSandboxBilling, SANDBOX_STRIPE_WEBHOOK_SECRET, signedSandboxEvent, type SandboxBilling, type SandboxStripeEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import type { StepRunner } from "../src/services/steps";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * BIL-2 with the M6 review's M1 / M3 / L13 rules: a checkout emits
 * `checkout.session.completed` (C), `customer.subscription.created` (K) and
 * `invoice.paid` (I). The sandbox posts them in that order and waits for each
 * `applied_at`, but the apply's later steps (credits, effects) interleave with
 * the next event's projection, and Stripe live sends them in any order. In
 * every one of the six orders, for a trial and for a resubscribe after an
 * end, the invoice grants the plan's credits exactly once and the entitlement
 * ends up following the new subscription; an invoice applied before the
 * entitlement follows its subscription still grants.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { applyBillingEvent, createBillingSession } = await import("../src/services/billing");
const { stripeWebhookRoutes } = await import("../src/webhooks/stripe");

const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const C1 = "c1000000-0000-4000-8000-000000000001";
const APP = "http://localhost:3100";
const NAMES = ["C", "K", "I"] as const;
const ORDERS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const label = (order: readonly number[]): string => order.map((i) => NAMES[i]).join(" → ");

let clock: SimClock;
let root: string;
const deps = () => fakeDeps(state, [], 200, "sandbox", root, clock);
const planGrants = () => (state.credits.get(OWNER) ?? []).filter((e) => e.kind === "grant_plan" && e.ref.startsWith("plan:"));
const balance = () => (state.credits.get(OWNER) ?? []).reduce((s, e) => s + e.amount, 0);

function billing(): SandboxBilling {
  const provider = deps().integrations.billing;
  if (!isSandboxBilling(provider)) throw new Error("expected sandbox billing");
  return provider;
}

/** Posts one signed event to the real webhook; the stored row's id when it is new and owned, else null. */
async function store(event: SandboxStripeEvent): Promise<string | null> {
  const webhook = stripeWebhookRoutes(deps(), { secret: SANDBOX_STRIPE_WEBHOOK_SECRET, emit: async () => undefined });
  const signed = signedSandboxEvent(event, SANDBOX_STRIPE_WEBHOOK_SECRET, clock.now());
  const response = await webhook.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signed.signature }, body: signed.body });
  const body = (await response.json()) as { billingEventId?: string; duplicate?: boolean };
  return response.status === 200 && body.duplicate === false ? (body.billingEventId ?? null) : null;
}

async function deliver(events: readonly SandboxStripeEvent[]): Promise<void> {
  for (const event of events) {
    const id = await store(event);
    if (id) await applyBillingEvent(deps(), directSteps, id, APP);
  }
}

/** The web's checkout row made ready by the worker, completed on the sandbox page: the three events, not delivered yet. */
async function checkoutEvents(planId: "pro" | "solo"): Promise<readonly SandboxStripeEvent[]> {
  const id = `b${state.billingSessions.size + 1}000000-0000-4000-8000-000000000000`.slice(0, 36);
  state.billingSessions.set(id, { id, userId: OWNER, kind: "checkout", planId, packId: null, status: "requested", url: null, providerRef: null, error: null });
  expect(await createBillingSession(deps(), directSteps, id, { appUrl: APP, finalAttempt: false })).toMatchObject({ status: "ready" });
  const events = await billing().completeCheckout(state.billingSessions.get(id)!.providerRef!);
  expect(events.map((e) => e.type)).toEqual(["checkout.session.completed", "customer.subscription.created", "invoice.paid"]);
  return events;
}

const subscriptionOf = (events: readonly SandboxStripeEvent[]): string => String((events[1]!.data.object as { id: string }).id);

beforeEach(async () => {
  Object.assign(state, emptyState());
  clock = new SimClock("2026-11-02T04:00:00.000Z");
  root = await mkdtemp(join(tmpdir(), "north-billing-order-"));
  seedCompany(state, { id: C1, ownerId: OWNER, slug: "lumen", name: "Lumen", timezone: "Europe/Istanbul" });
});

describe("BIL-2 the checkout's invoice grants exactly once in every delivery order (M1 / M3 / L13)", () => {
  it.each(ORDERS.map((order) => [label(order), order] as const))("trial → Pro, %s: active Pro on the new subscription, +1 000 once", async (_name, order) => {
    const events = await checkoutEvents("pro");
    await deliver(order.map((i) => events[i]!));
    const sub = subscriptionOf(events);
    const e = state.entitlements.get(OWNER)!;
    expect(e).toMatchObject({ status: "active", planId: "pro", companyLimit: 3, monthlyCredits: 1000, stripeSubscriptionId: sub });
    expect(planGrants().map((g) => [g.ref, g.amount])).toEqual([[`plan:${sub}:${e.periodStart}`, 1000]]);
    await deliver([...events].reverse());
    expect(planGrants()).toHaveLength(1);
    expect(balance()).toBe(1300);
  });

  it.each(ORDERS.map((order) => [label(order), order] as const))("ended Pro → Solo, %s: active Solo on the new subscription, +300 once, the company resumed", async (_name, order) => {
    const first = await checkoutEvents("pro");
    await deliver(first);
    await deliver(await billing().endNow(state.entitlements.get(OWNER)!.stripeCustomerId!));
    expect(state.entitlements.get(OWNER)?.status).toBe("ended");
    const events = await checkoutEvents("solo");
    await deliver(order.map((i) => events[i]!));
    const sub = subscriptionOf(events);
    const e = state.entitlements.get(OWNER)!;
    expect(e).toMatchObject({ status: "active", planId: "solo", companyLimit: 1, stripeSubscriptionId: sub, endedAt: null });
    expect(planGrants().filter((g) => g.ref.startsWith(`plan:${sub}:`)).map((g) => [g.ref, g.amount])).toEqual([[`plan:${sub}:${e.periodStart}`, 300]]);
    expect(state.killSwitch.get(C1)).toBe(false);
  });

  it("the sandbox's own interleaving: I's projection, then C and K applied whole, then I's credits step: +1 000 once", async () => {
    const events = await checkoutEvents("pro");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated: StepRunner = { run: async (id, fn) => (id === "credits" ? gate.then(fn) : fn()) };
    const invoiceId = (await store(events[2]!))!;
    const pending = applyBillingEvent(deps(), gated, invoiceId, APP);
    await vi.waitFor(() => expect(state.billingEvents.get(invoiceId)?.appliedAt).not.toBeNull());
    expect(planGrants()).toEqual([]);
    await deliver([events[0]!, events[1]!]);
    release();
    expect(await pending).toMatchObject({ applied: true, credits: [expect.stringMatching(/^plan:/)] });
    expect(planGrants().map((g) => g.amount)).toEqual([1000]);
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "active", planId: "pro" });
  });
});

describe("BIL-2 an invoice grant's plan is never a guess", () => {
  /** The same deps with a provider whose subscription read fails (Stripe unreachable). */
  const failingProvider = () => {
    const sandbox = billing();
    const broken = Object.assign(Object.create(Object.getPrototypeOf(sandbox) as object) as SandboxBilling, sandbox, { subscription: async () => Promise.reject(new Error("stripe down")) });
    return { ...deps(), integrations: { ...deps().integrations, billing: broken } };
  };
  /** The invoice as an API version before 2025-03 sends it: the subscription line names its price's lookup key. */
  const withLookupKey = (event: SandboxStripeEvent, lookupKey: string): SandboxStripeEvent => {
    const object = event.data.object as { lines: { data: Record<string, unknown>[] } };
    const lines = { ...object.lines, data: object.lines.data.map((line) => ({ ...line, price: { lookup_key: lookupKey } })) };
    return { ...event, data: { object: { ...(event.data.object as Record<string, unknown>), lines } } };
  };

  it("invoice.paid before the subscription, the provider failing, the line naming Pro → +1 000 (not the trial's 300)", async () => {
    const events = await checkoutEvents("pro");
    const id = (await store(withLookupKey(events[2]!, "north_pro_monthly")))!;
    expect(await applyBillingEvent(failingProvider(), directSteps, id, APP)).toMatchObject({ applied: true, credits: [expect.stringMatching(/^plan:/)] });
    expect(planGrants().map((g) => g.amount)).toEqual([1000]);
  });

  it("no lookup key on the line and the provider failing → the credits step throws for Inngest to retry; nothing is granted", async () => {
    const events = await checkoutEvents("pro");
    const id = (await store(events[2]!))!;
    await expect(applyBillingEvent(failingProvider(), directSteps, id, APP)).rejects.toThrow(/plan of invoice/);
    expect(planGrants()).toEqual([]);
  });

  it("with the provider up, a line without a lookup key is named by the invoice's own subscription at the provider", async () => {
    const events = await checkoutEvents("pro");
    await deliver([events[2]!]);
    expect(planGrants().map((g) => g.amount)).toEqual([1000]);
  });
});
