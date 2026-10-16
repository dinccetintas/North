import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT } from "@north/core";
import { isSandboxBilling, SANDBOX_STRIPE_WEBHOOK_SECRET, signedSandboxEvent, type SandboxBilling, type SandboxStripeEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeBillingSession, type FakeState } from "./fake-db";

/**
 * D6-3 (BIL-1, BIL-2, ADR 0014), fake db + sandbox billing + the real
 * webhook route: a checkout session row becomes `ready` with the worker's
 * sandbox URL; the three sandbox events make the trial Pro `active` with
 * 1 000 credits; a replayed `invoice.paid` grants nothing;
 * `subscription.deleted` → `ended`, both companies flagged
 * `subscription_ended` and two kill-switch events within 5 s;
 * `subscription.created` after that clears the flags and returns two resume
 * events; `past_due` → one notification; the period roll grants the new
 * period and expires the old one's unused credits.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { applyBillingEvent, createBillingSession } = await import("../src/services/billing");
const { stripeWebhookRoutes } = await import("../src/webhooks/stripe");

const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
const APP = "http://localhost:3100";
let clock: SimClock;
let root: string;
let applied: Awaited<ReturnType<typeof applyBillingEvent>>[];
const deps = () => fakeDeps(state, [], 200, "sandbox", root, clock);
const balance = () => (state.credits.get(OWNER) ?? []).reduce((s, e) => s + e.amount, 0);
const refs = () => (state.credits.get(OWNER) ?? []).map((e) => `${e.kind}:${e.ref}:${e.amount}`);

function billing(): SandboxBilling {
  const provider = deps().integrations.billing;
  if (!isSandboxBilling(provider)) throw new Error("expected sandbox billing");
  return provider;
}

/** The sandbox page's job: sign each event, post it to the webhook, apply what it stored (in order, as `apply-billing-event` does one at a time per user). */
async function deliver(events: readonly SandboxStripeEvent[]): Promise<{ status: number; body: Record<string, unknown> }[]> {
  const webhook = stripeWebhookRoutes(deps(), { secret: SANDBOX_STRIPE_WEBHOOK_SECRET, emit: async () => undefined });
  const out: { status: number; body: Record<string, unknown> }[] = [];
  for (const event of events) {
    const signed = signedSandboxEvent(event, SANDBOX_STRIPE_WEBHOOK_SECRET, clock.now());
    const response = await webhook.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signed.signature }, body: signed.body });
    const body = (await response.json()) as Record<string, unknown>;
    out.push({ status: response.status, body });
    if (response.status === 200 && body.duplicate === false) applied.push(await applyBillingEvent(deps(), directSteps, String(body.billingEventId), APP));
  }
  return out;
}

function requestSession(row: Partial<FakeBillingSession> & Pick<FakeBillingSession, "kind">): string {
  const id = `b${state.billingSessions.size + 1}000000-0000-4000-8000-000000000000`.slice(0, 36);
  state.billingSessions.set(id, { id, userId: OWNER, planId: null, packId: null, status: "requested", url: null, providerRef: null, error: null, ...row });
  return id;
}

async function subscribePro(): Promise<{ readonly customerId: string; readonly events: readonly SandboxStripeEvent[] }> {
  const sessionId = requestSession({ kind: "checkout", planId: "pro" });
  const ready = await createBillingSession(deps(), directSteps, sessionId, { appUrl: APP, finalAttempt: false });
  expect(ready).toMatchObject({ status: "ready" });
  const session = state.billingSessions.get(sessionId)!;
  const events = await billing().completeCheckout(session.providerRef!);
  await deliver(events);
  return { customerId: state.entitlements.get(OWNER)!.stripeCustomerId!, events };
}

beforeEach(async () => {
  Object.assign(state, emptyState());
  clock = new SimClock("2026-11-02T04:00:00.000Z");
  root = await mkdtemp(join(tmpdir(), "north-billing-"));
  applied = [];
  seedCompany(state, { id: C1, ownerId: OWNER, slug: "lumen", name: "Lumen", timezone: "Europe/Istanbul" });
  seedCompany(state, { id: C2, ownerId: OWNER, slug: "atlas", name: "Atlas", timezone: "Europe/Istanbul" });
  state.pushSubscriptions = [{ endpoint: "https://push.example.test/a", p256dh: "p", auth: "a" }];
});

describe("D6-3 createBillingSession", () => {
  it("a checkout row becomes ready with the worker's sandbox checkout URL; the customer is created once and stored; the success URL names the session", async () => {
    const sessionId = requestSession({ kind: "checkout", planId: "pro" });
    expect(await createBillingSession(deps(), directSteps, sessionId, { appUrl: APP, finalAttempt: false })).toEqual({ sessionId, status: "ready", url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:3101\/sandbox\/billing\/checkout\/cs_/) });
    const row = state.billingSessions.get(sessionId)!;
    expect(row).toMatchObject({ status: "ready", providerRef: expect.stringMatching(/^cs_/) });
    const stored = await billing().checkoutSession(row.providerRef!);
    expect(stored).toMatchObject({ mode: "subscription", lookupKey: "north_pro_monthly", clientReferenceId: OWNER, successUrl: `${APP}/settings/billing?checkout=${sessionId}`, cancelUrl: `${APP}/settings/billing?canceled=1` });
    expect(state.entitlements.get(OWNER)?.stripeCustomerId).toMatch(/^cus_/);
    expect(await createBillingSession(deps(), directSteps, sessionId, { appUrl: APP, finalAttempt: false })).toEqual({ sessionId, status: "skipped", reason: "ready" });
  });

  it("a subscriber is refused a second checkout (plans change in the portal); a portal session opens the sandbox portal; a pack session sells pack_100", async () => {
    const { customerId } = await subscribePro();
    const again = requestSession({ kind: "checkout", planId: "scale" });
    expect(await createBillingSession(deps(), directSteps, again, { appUrl: APP, finalAttempt: false })).toMatchObject({ status: "failed", error: expect.stringContaining("Manage billing") });
    expect(state.billingSessions.get(again)).toMatchObject({ status: "failed", url: null });
    const portal = requestSession({ kind: "portal" });
    expect(await createBillingSession(deps(), directSteps, portal, { appUrl: APP, finalAttempt: false })).toMatchObject({ status: "ready", url: `http://127.0.0.1:3101/sandbox/billing/portal/${customerId}` });
    const pack = requestSession({ kind: "credit_pack", packId: "pack_100" });
    await createBillingSession(deps(), directSteps, pack, { appUrl: APP, finalAttempt: false });
    expect(await billing().checkoutSession(state.billingSessions.get(pack)!.providerRef!)).toMatchObject({ mode: "payment", packId: "pack_100" });
  });

  it("a provider error fails the session with a fixed message; an unexpected error retries, and fails the session on the last attempt", async () => {
    await subscribePro();
    state.entitlements.set(OWNER, { ...state.entitlements.get(OWNER)!, stripeCustomerId: "cus_sandbox_404" });
    const portal = requestSession({ kind: "portal" });
    expect(await createBillingSession(deps(), directSteps, portal, { appUrl: APP, finalAttempt: false })).toMatchObject({ status: "failed", error: expect.stringMatching(/customer record/) });
    const broken = { ...deps(), integrations: { ...deps().integrations, billing: { ...billing(), createPortalSession: async () => Promise.reject(new Error("socket hang up")) } } };
    const retried = requestSession({ kind: "portal" });
    await expect(createBillingSession(broken as never, directSteps, retried, { appUrl: APP, finalAttempt: false })).rejects.toThrow(/socket hang up/);
    expect(state.billingSessions.get(retried)?.status).toBe("requested");
    expect(await createBillingSession(broken as never, directSteps, retried, { appUrl: APP, finalAttempt: true })).toMatchObject({ status: "failed", error: expect.stringMatching(/unavailable/) });
  });
});

describe("D6-3 applyBillingEvent", () => {
  it("the three sandbox events make the trial Pro active with 1 000 credits (balance 1 300); each event is applied once", async () => {
    await subscribePro();
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "active", planId: "pro", companyLimit: 3, monthlyCredits: 1000, priceUsd: 299, stripeCustomerId: expect.stringMatching(/^cus_/), stripeSubscriptionId: expect.stringMatching(/^sub_/) });
    expect([...state.billingEvents.values()].map((e) => [e.type, e.appliedAt !== null])).toEqual([
      ["checkout.session.completed", true],
      ["customer.subscription.created", true],
      ["invoice.paid", true],
    ]);
    const sub = state.entitlements.get(OWNER)!.stripeSubscriptionId;
    expect(refs()).toEqual([`grant_plan:trial:${OWNER}:300`, `grant_plan:plan:${sub}:${state.entitlements.get(OWNER)!.periodStart}:1000`]);
    expect(balance()).toBe(1300);
    expect(applied.map((a) => a.transition)).toEqual([null, null, null]);
  });

  it("a replayed invoice.paid is a duplicate and grants nothing; applying a stored event twice is a no-op", async () => {
    const { events } = await subscribePro();
    const replay = await deliver([events[2]!]);
    expect(replay).toEqual([{ status: 200, body: { billingEventId: expect.any(String), duplicate: true } }]);
    expect(await applyBillingEvent(deps(), directSteps, String(replay[0]!.body.billingEventId), APP)).toMatchObject({ applied: false, reason: "applied" });
    expect(balance()).toBe(1300);
  });

  it("subscription.deleted → ended with retention, both companies flagged subscription_ended, two kill-switch events within 5 s; a new subscription clears them with two resume events", async () => {
    const { customerId } = await subscribePro();
    const startedAt = clock.now().getTime();
    await deliver(await billing().endNow(customerId));
    const end = applied.at(-1)!;
    expect(clock.now().getTime() - startedAt).toBeLessThan(5000);
    expect(end).toMatchObject({ applied: true, transition: "ended", events: [C1, C2].map((companyId) => ({ name: EVENT.companyKillSwitch, data: { companyId } })) });
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "ended", endedAt: expect.stringMatching(/^2026-11-02/), retentionUntil: expect.stringMatching(/^2027-01-31/) });
    expect([state.pausedReasons.get(C1), state.pausedReasons.get(C2)]).toEqual(["subscription_ended", "subscription_ended"]);
    expect([state.killSwitch.get(C1), state.killSwitch.get(C2)]).toEqual([true, true]);

    const resubscribe = requestSession({ kind: "checkout", planId: "solo" });
    await createBillingSession(deps(), directSteps, resubscribe, { appUrl: APP, finalAttempt: false });
    await deliver(await billing().completeCheckout(state.billingSessions.get(resubscribe)!.providerRef!));
    const reactivated = applied.find((a) => a.transition === "reactivated");
    expect(reactivated?.events).toEqual([C1, C2].map((companyId) => ({ name: EVENT.companyResume, data: { companyId } })));
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "active", planId: "solo", companyLimit: 1, endedAt: null, retentionUntil: null });
    expect([state.killSwitch.get(C1), state.killSwitch.get(C2)]).toEqual([false, false]);
    expect(refs().filter((r) => r.startsWith("grant_plan:plan:")).map((r) => r.split(":").at(-1))).toEqual(["1000", "300"]);
  });

  it("cancel at period end → canceled: still running, no effects", async () => {
    const { customerId } = await subscribePro();
    await deliver(await billing().cancelAtPeriodEnd(customerId));
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "canceled", cancelAt: state.entitlements.get(OWNER)!.periodEnd });
    expect(applied.at(-1)).toMatchObject({ applied: true, transition: null, events: [] });
    expect(state.killSwitch.get(C1)).toBeUndefined();
  });

  it("past_due → one billing_past_due notice (push + email); the period roll grants the new period and expires the old one's unused plan credits", async () => {
    const { customerId } = await subscribePro();
    const before = state.entitlements.get(OWNER)!;
    await deliver(await billing().failPayment(customerId));
    expect(state.entitlements.get(OWNER)?.status).toBe("past_due");
    expect(applied.at(-1)).toMatchObject({ transition: "past_due", events: [] });
    const notices = (state.notifications as { kind: string; channel: string }[]).filter((n) => n.kind === "billing_past_due");
    expect(notices.map((n) => n.channel)).toEqual(["push", "email"]);
    await deliver(await billing().advancePeriod(customerId));
    const after = state.entitlements.get(OWNER)!;
    expect(after).toMatchObject({ status: "active" });
    expect(after.periodStart).not.toBe(before.periodStart);
    expect(refs()).toContain(`expire:expire:${before.periodStart}:-1000`);
    expect(refs()).toContain(`grant_plan:plan:${after.stripeSubscriptionId}:${after.periodStart}:1000`);
    expect(balance()).toBe(1300);
  });

  it("a pack checkout grants +100 once (pack:<session>), and the trial's credits do not expire when the user subscribes", async () => {
    await subscribePro();
    const pack = requestSession({ kind: "credit_pack", packId: "pack_100" });
    await createBillingSession(deps(), directSteps, pack, { appUrl: APP, finalAttempt: false });
    const cs = state.billingSessions.get(pack)!.providerRef!;
    const events = await billing().completeCheckout(cs);
    await deliver(events);
    await deliver(events);
    expect(refs()).toContain(`grant_pack:pack:${cs}:100`);
    expect(balance()).toBe(1400);
  });
});

/** A sandbox event re-shaped as Stripe would send another one: a new id, and the given type, `created` and object fields. */
function variant(event: SandboxStripeEvent, id: string, patch: { type?: string; created?: number; object?: Record<string, unknown> }): SandboxStripeEvent {
  return { ...event, id, type: (patch.type ?? event.type) as SandboxStripeEvent["type"], created: patch.created ?? event.created, data: { object: { ...(event.data.object as Record<string, unknown>), ...patch.object } } };
}

async function packEvents(): Promise<{ readonly cs: string; readonly events: readonly SandboxStripeEvent[] }> {
  const pack = requestSession({ kind: "credit_pack", packId: "pack_100" });
  await createBillingSession(deps(), directSteps, pack, { appUrl: APP, finalAttempt: false });
  const cs = state.billingSessions.get(pack)!.providerRef!;
  return { cs, events: await billing().completeCheckout(cs) };
}

describe("M6 security review: billing (H1, M1, M3, L10)", () => {
  it("H1: a pack completed unpaid (ACH) grants nothing; its async_payment_succeeded grants +100 once; async_payment_failed is ignored with no row", async () => {
    await subscribePro();
    const { cs, events } = await packEvents();
    const completed = events[0]!;
    await deliver([variant(completed, "evt_pack_unpaid", { object: { payment_status: "unpaid" } })]);
    expect(balance()).toBe(1300);
    expect(refs().some((r) => r.startsWith("grant_pack:"))).toBe(false);
    const failed = await deliver([variant(completed, "evt_pack_failed", { type: "checkout.session.async_payment_failed" })]);
    expect(failed).toEqual([{ status: 200, body: { ignored: "checkout.session.async_payment_failed" } }]);
    const succeeded = variant(completed, "evt_pack_paid", { type: "checkout.session.async_payment_succeeded" });
    await deliver([succeeded, succeeded]);
    expect(refs().filter((r) => r.startsWith("grant_pack:"))).toEqual([`grant_pack:pack:${cs}:100`]);
    expect(balance()).toBe(1400);
    expect([...state.billingEvents.values()].map((e) => e.type)).not.toContain("checkout.session.async_payment_failed");
  });

  it("H1: a paid payment-mode checkout without the pack id, at another amount or currency grants nothing", async () => {
    await subscribePro();
    const { events } = await packEvents();
    const completed = events[0]!;
    await deliver([
      variant(completed, "evt_pack_no_id", { object: { metadata: { north_user_id: OWNER } } }),
      variant(completed, "evt_pack_cheap", { object: { amount_total: 100 } }),
      variant(completed, "evt_pack_eur", { object: { currency: "eur" } }),
    ]);
    expect(balance()).toBe(1300);
  });

  it("M3: a proration invoice mid-period grants nothing and does not move the period", async () => {
    const { events } = await subscribePro();
    const before = state.entitlements.get(OWNER)!;
    const paid = events[2]!;
    const lines = (paid.data.object as { lines: { data: Record<string, unknown>[] } }).lines;
    const mid = Math.floor(Date.parse(before.periodStart) / 1000) + 14 * 86_400;
    const proration = { ...lines.data[0]!, id: "il_proration", amount: 70_000, period: { start: mid, end: Math.floor(Date.parse(before.periodEnd) / 1000) }, parent: { type: "invoice_item_details", invoice_item_details: { invoice_item: "ii_1", proration: true } } };
    await deliver([variant(paid, "evt_proration", { created: paid.created + 60, object: { id: "in_proration", billing_reason: "subscription_update", amount_paid: 70_000, lines: { ...lines, data: [proration] } } })]);
    expect(applied.at(-1)).toMatchObject({ applied: true, ignored: "not a plan invoice", credits: [], events: [] });
    expect(state.entitlements.get(OWNER)).toMatchObject({ periodStart: before.periodStart, periodEnd: before.periodEnd, status: "active" });
    expect(balance()).toBe(1300);
  });

  it("M1 sequence A: S1 ends, S2 starts, S1's old invoice is paid, S2 is cancelled → ended, kill switch on both companies", async () => {
    const { customerId, events } = await subscribePro();
    const s1 = state.entitlements.get(OWNER)!.stripeSubscriptionId!;
    await deliver(await billing().endNow(customerId));
    const solo = requestSession({ kind: "checkout", planId: "solo" });
    await createBillingSession(deps(), directSteps, solo, { appUrl: APP, finalAttempt: false });
    await deliver(await billing().completeCheckout(state.billingSessions.get(solo)!.providerRef!));
    const s2 = state.entitlements.get(OWNER)!.stripeSubscriptionId!;
    expect([s2 !== s1, state.entitlements.get(OWNER)!.status]).toEqual([true, "active"]);
    const old = events[2]!;
    await deliver([variant(old, "evt_old_invoice_paid", { created: old.created + 120, object: { billing_reason: "subscription_cycle" } })]);
    expect(applied.at(-1)).toMatchObject({ ignored: "another subscription", events: [] });
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "active", stripeSubscriptionId: s2 });
    await deliver(await billing().endNow(customerId));
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "ended", stripeSubscriptionId: s2 });
    expect(applied.at(-1)).toMatchObject({ transition: "ended", events: [C1, C2].map((companyId) => ({ name: EVENT.companyKillSwitch, data: { companyId } })) });
  });

  it("M1 sequence B: payment_failed (t+101) applied, then subscription.deleted (t+100) arrives late → ended, kill switch", async () => {
    const { customerId } = await subscribePro();
    const [failed] = await billing().failPayment(customerId);
    const late = variant(failed!, "evt_late_delete", { type: "customer.subscription.deleted", created: failed!.created + 101, object: {} });
    await deliver([variant(failed!, failed!.id, { created: failed!.created + 101 })]);
    expect(state.entitlements.get(OWNER)?.status).toBe("past_due");
    const [ended] = await billing().endNow(customerId);
    await deliver([variant(ended!, late.id, { created: failed!.created + 100 })]);
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "ended", lastEventCreated: failed!.created + 101 });
    expect(applied.at(-1)).toMatchObject({ transition: "ended", events: [C1, C2].map((companyId) => ({ name: EVENT.companyKillSwitch, data: { companyId } })) });
  });

  it("L10: a second checkout is refused while the first is open; once its event is applied the session is completed and no longer holds one back", async () => {
    const first = requestSession({ kind: "checkout", planId: "pro" });
    await createBillingSession(deps(), directSteps, first, { appUrl: APP, finalAttempt: false });
    const second = requestSession({ kind: "checkout", planId: "scale" });
    expect(await createBillingSession(deps(), directSteps, second, { appUrl: APP, finalAttempt: false })).toMatchObject({ status: "failed", error: expect.stringContaining("already open") });
    const old = requestSession({ kind: "checkout", planId: "solo", status: "ready", url: "http://127.0.0.1:3101/x", providerRef: "cs_old", createdAt: new Date(Date.now() - 36 * 60_000).toISOString() });
    expect(old).toBeTruthy();
    await deliver(await billing().completeCheckout(state.billingSessions.get(first)!.providerRef!));
    expect(state.billingSessions.get(first)?.completedAt).toEqual(expect.any(String));
    const { customerId } = { customerId: state.entitlements.get(OWNER)!.stripeCustomerId! };
    await deliver(await billing().endNow(customerId));
    const third = requestSession({ kind: "checkout", planId: "solo" });
    expect(await createBillingSession(deps(), directSteps, third, { appUrl: APP, finalAttempt: false })).toMatchObject({ status: "ready" });
  });

  it("M5: a resubscribe during a purge is refused by the database: not applied (purging), left unapplied, nothing reactivated", async () => {
    const { customerId } = await subscribePro();
    await deliver(await billing().endNow(customerId));
    const ended = state.entitlements.get(OWNER)!;
    state.entitlements.set(OWNER, { ...ended, retentionUntil: "2026-10-01T00:00:00.000Z" });
    state.purgeStarted.set(OWNER, "2026-11-02T04:00:00.000Z");
    const solo = requestSession({ kind: "checkout", planId: "solo" });
    await createBillingSession(deps(), directSteps, solo, { appUrl: APP, finalAttempt: false });
    const events = await billing().completeCheckout(state.billingSessions.get(solo)!.providerRef!);
    await deliver(events);
    const created = [...state.billingEvents.values()].find((e) => e.eventId === events[1]!.id)!;
    expect(applied.slice(-3).map((a) => [a.type ?? null, a.applied, a.reason ?? null])).toEqual([
      ["checkout.session.completed", true, null],
      [null, false, "purging"],
      ["invoice.paid", true, null],
    ]);
    expect(created.appliedAt).toBeNull();
    expect(state.entitlements.get(OWNER)?.status).toBe("ended");
    expect([state.killSwitch.get(C1), state.killSwitch.get(C2)]).toEqual([true, true]);
  });

  it("L10: the projection is written only over the row it was read from; a row changed meanwhile fails the step, which re-reads and applies", async () => {
    const { customerId } = await subscribePro();
    const [cancel] = await billing().cancelAtPeriodEnd(customerId);
    const webhook = stripeWebhookRoutes(deps(), { secret: SANDBOX_STRIPE_WEBHOOK_SECRET, emit: async () => undefined });
    const signed = signedSandboxEvent(cancel!, SANDBOX_STRIPE_WEBHOOK_SECRET, clock.now());
    const body = (await (await webhook.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signed.signature }, body: signed.body })).json()) as { billingEventId: string };
    const stale = { ...state.entitlements.get(OWNER)! };
    state.entitlements.set(OWNER, { ...stale, purgeDue: true });
    dbModule.getEntitlement.mockImplementationOnce(async () => stale);
    await expect(applyBillingEvent(deps(), directSteps, body.billingEventId, APP)).rejects.toThrow(/changed since it was read/);
    expect(state.billingEvents.get(body.billingEventId)?.appliedAt).toBeNull();
    expect(await applyBillingEvent(deps(), directSteps, body.billingEventId, APP)).toMatchObject({ applied: true, status: "canceled" });
  });
});
