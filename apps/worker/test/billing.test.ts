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
