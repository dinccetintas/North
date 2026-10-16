import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT, trialEntitlement, type Entitlement } from "@north/core";
import { isSandboxBilling, type SandboxBilling } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D6-3 (BIL-1, BIL-2, ADR 0014): `dispatchAllowed` asks the kill switch,
 * then the entitlement, then the credits; an expired trial ends through the
 * kill switch like a cancelled subscription; `company/resume` is refused
 * while the entitlement is not active and allowed again after `reactivate`.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { dispatchAllowed, endExpiredTrials, endSubscription, reactivate } = await import("../src/services/entitlements");
const { healPlanGrants, HEAL_AFTER_HOURS, reconcileSubscriptions, RECONCILE_AFTER_DAYS } = await import("../src/services/reconcile");
const { resumeAllowed } = await import("../src/services/kill-switch");

const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
let clock: SimClock;
const deps = () => fakeDeps(state, [], 200, "sandbox", "/tmp/north-test-sandbox", clock);
const entitlement = (patch: Partial<Entitlement> = {}): Entitlement => ({ ...trialEntitlement(OWNER, clock.now()), ...patch });
/** The ledger sums to zero (the trial grant and an `adjust` of the same size). */
const drain = () => state.credits.set(OWNER, [{ kind: "grant_plan", amount: 300, ref: `trial:${OWNER}`, note: "" }, { kind: "adjust", amount: -300, ref: "adjust:drain", note: "" }]);

beforeEach(() => {
  Object.assign(state, emptyState());
  clock = new SimClock("2026-11-02T04:00:00.000Z");
  seedCompany(state, { id: C1, ownerId: OWNER, slug: "lumen", name: "Lumen", timezone: "Europe/Istanbul" });
  seedCompany(state, { id: C2, ownerId: OWNER, slug: "atlas", name: "Atlas", timezone: "Europe/Istanbul" });
});

describe("D6-3 dispatchAllowed", () => {
  it("a trial with credits runs; zero credits block with credits_exhausted", async () => {
    expect(await dispatchAllowed(deps(), C1)).toEqual({ ok: true });
    drain();
    expect(await dispatchAllowed(deps(), C1)).toEqual({ ok: false, reason: "credits_exhausted" });
  });

  it("orders the kill switch first, then the entitlement, then the credits", async () => {
    drain();
    state.entitlements.set(OWNER, entitlement({ status: "ended", endedAt: clock.now().toISOString(), retentionUntil: "2027-01-31T04:00:00.000Z" }));
    expect(await dispatchAllowed(deps(), C1)).toEqual({ ok: false, reason: "subscription_ended" });
    state.killSwitch.set(C1, true);
    state.pausedReasons.set(C1, "user");
    expect(await dispatchAllowed(deps(), C1)).toEqual({ ok: false, reason: "kill_switch" });
    state.pausedReasons.set(C1, "subscription_ended");
    expect(await dispatchAllowed(deps(), C1)).toEqual({ ok: false, reason: "subscription_ended" });
    state.archived.add(C2);
    state.killSwitch.set(C2, true);
    state.pausedReasons.set(C2, "retention");
    expect(await dispatchAllowed(deps(), C2)).toEqual({ ok: false, reason: "retention" });
  });

  it("an unknown company is refused (fail closed)", async () => {
    expect(await dispatchAllowed(deps(), "c9000000-0000-4000-8000-000000000009")).toEqual({ ok: false, reason: "kill_switch" });
  });
});

describe("D6-3 endSubscription / reactivate", () => {
  it("flags every running company subscription_ended and returns one kill-switch event each; a user pause and an archive are left alone", async () => {
    const third = "c3000000-0000-4000-8000-000000000003";
    const fourth = "c4000000-0000-4000-8000-000000000004";
    seedCompany(state, { id: third, ownerId: OWNER, slug: "third", name: "Third" });
    seedCompany(state, { id: fourth, ownerId: OWNER, slug: "fourth", name: "Fourth" });
    state.killSwitch.set(third, true);
    state.pausedReasons.set(third, "user");
    state.archived.add(fourth);
    const ended = await endSubscription(deps(), OWNER);
    expect(ended.companies).toEqual([C1, C2, third]);
    expect(ended.events).toEqual([C1, C2, third].map((companyId) => ({ name: EVENT.companyKillSwitch, data: { companyId } })));
    expect(ended.ms).toBeLessThan(5000);
    expect([state.pausedReasons.get(C1), state.pausedReasons.get(C2), state.pausedReasons.get(third)]).toEqual(["subscription_ended", "subscription_ended", "user"]);
    expect(state.killSwitch.get(fourth)).toBeUndefined();

    state.entitlements.set(OWNER, entitlement({ status: "active", priceUsd: 99, stripeSubscriptionId: "sub_sandbox_2" }));
    const revived = await reactivate(deps(), OWNER);
    expect(revived.companies).toEqual([C1, C2]);
    expect(revived.events).toEqual([C1, C2].map((companyId) => ({ name: EVENT.companyResume, data: { companyId } })));
    expect([state.killSwitch.get(C1), state.killSwitch.get(C2), state.killSwitch.get(third)]).toEqual([false, false, true]);
    expect(state.pausedReasons.get(third)).toBe("user");
  });

  it("M5: reactivate does nothing while a purge runs for the owner: no flag lifted, no archive undone, no resume event", async () => {
    await endSubscription(deps(), OWNER);
    state.archived.add(C2);
    state.pausedReasons.set(C2, "retention");
    state.purgeStarted.set(OWNER, "2027-02-01T00:00:00.000Z");
    expect(await reactivate(deps(), OWNER)).toEqual({ userId: OWNER, companies: [], events: [] });
    expect([state.killSwitch.get(C1), state.pausedReasons.get(C1), state.archived.has(C2)]).toEqual([true, "subscription_ended", true]);
  });

  it("reactivate restores a company the retention sweep archived (a subscription before the purge)", async () => {
    state.archived.add(C2);
    state.killSwitch.set(C2, true);
    state.pausedReasons.set(C2, "retention");
    const revived = await reactivate(deps(), OWNER);
    expect(revived.companies).toEqual([C2]);
    expect(state.archived.has(C2)).toBe(false);
    expect(state.killSwitch.get(C2)).toBe(false);
  });
});

describe("D6-3 endExpiredTrials (entitlements-tick)", () => {
  it("ends a trial whose period end passed on the worker's clock, with retention + 90 days, through the kill switch; the next tick finds nothing", async () => {
    state.entitlements.set(OWNER, entitlement({ periodEnd: "2026-11-16T04:00:00.000Z" }));
    expect(await endExpiredTrials(deps())).toEqual({ ended: [], events: [] });
    clock.set("2026-11-16T05:00:00.000Z");
    const first = await endExpiredTrials(deps());
    expect(first.ended).toEqual([OWNER]);
    expect(first.events.map((e) => e.data.companyId)).toEqual([C1, C2]);
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "ended", endedAt: expect.stringMatching(/^2026-11-16T05:00/), retentionUntil: expect.stringMatching(/^2027-02-14T05:00/) });
    expect(await endExpiredTrials(deps())).toEqual({ ended: [], events: [] });
  });
});

describe("M6 review L10: the tick never writes a stale trial over a newer row", () => {
  it("a trial the apply step activated between the tick's read and its write stays active; nothing is stopped", async () => {
    const expired = entitlement({ periodEnd: "2026-11-01T04:00:00.000Z" });
    state.entitlements.set(OWNER, { ...expired, status: "active", priceUsd: 299, stripeSubscriptionId: "sub_sandbox_1", lastEventCreated: 1_793_592_000 });
    dbModule.listTrialsToEnd.mockImplementationOnce(async () => [expired]);
    expect(await endExpiredTrials(deps())).toEqual({ ended: [], events: [] });
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "active", stripeSubscriptionId: "sub_sandbox_1" });
    expect(state.killSwitch.get(C1)).toBeUndefined();
  });
});

describe("M6 review M1: entitlements-tick reconciles a subscription whose end never arrived", () => {
  const DAY = 86_400_000;
  let root: string;
  const sandboxDeps = () => fakeDeps(state, [], 200, "sandbox", root, clock);
  const billing = (): SandboxBilling => {
    const provider = sandboxDeps().integrations.billing;
    if (!isSandboxBilling(provider)) throw new Error("sandbox billing");
    return provider;
  };
  /** A Pro subscription in the sandbox account and the entitlement that follows it (the webhooks are not delivered: that is the point). */
  async function subscribed(userId = OWNER): Promise<{ readonly customerId: string; readonly subscriptionId: string }> {
    const { customerId } = await billing().ensureCustomer({ userId, email: "ceo@example.test" });
    const session = await billing().createCheckoutSession({ customerId, lookupKey: "north_pro_monthly", mode: "subscription", clientReferenceId: userId, successUrl: "http://localhost:3100/s", cancelUrl: "http://localhost:3100/c", idempotencyKey: `k-${userId}` });
    await billing().completeCheckout(session.providerRef);
    const sub = (await billing().subscription(customerId))!;
    state.entitlements.set(userId, { ...entitlement(), userId, status: "active", planId: "pro", companyLimit: 3, monthlyCredits: 1000, priceUsd: 299, stripeCustomerId: customerId, stripeSubscriptionId: sub.id, periodStart: clock.now().toISOString(), periodEnd: sub.periodEnd!, lastEventCreated: Math.floor(clock.now().getTime() / 1000) });
    return { customerId, subscriptionId: sub.id };
  }

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    root = await mkdtemp(join(tmpdir(), "north-reconcile-"));
  });

  it(`a subscription the provider says is canceled ends ${RECONCILE_AFTER_DAYS} days after its period end, through the kill switch, with the event clock moved to now`, async () => {
    const { customerId } = await subscribed();
    await billing().endNow(customerId);
    const periodEnd = Date.parse(state.entitlements.get(OWNER)!.periodEnd);
    clock.set(new Date(periodEnd + (RECONCILE_AFTER_DAYS - 1) * DAY).toISOString());
    expect(await reconcileSubscriptions(sandboxDeps())).toEqual({ checked: 0, ended: [], events: [] });
    clock.set(new Date(periodEnd + RECONCILE_AFTER_DAYS * DAY + 60_000).toISOString());
    const result = await reconcileSubscriptions(sandboxDeps());
    expect(result).toEqual({ checked: 1, ended: [OWNER], events: [C1, C2].map((companyId) => ({ name: EVENT.companyKillSwitch, data: { companyId } })) });
    const ended = state.entitlements.get(OWNER)!;
    expect(ended.status).toBe("ended");
    // The simulated clock runs at wall speed: the end and the event clock are "now", give or take the test's own milliseconds.
    expect(Math.abs(Date.parse(ended.endedAt!) - clock.now().getTime())).toBeLessThan(5000);
    expect(Math.abs(ended.lastEventCreated! - clock.now().getTime() / 1000)).toBeLessThan(5);
    expect([state.pausedReasons.get(C1), state.pausedReasons.get(C2)]).toEqual(["subscription_ended", "subscription_ended"]);
    expect(await reconcileSubscriptions(sandboxDeps())).toEqual({ checked: 0, ended: [], events: [] });
  });

  it("a canceled-at-period-end subscription is checked from cancel_at; one the provider no longer knows ends; one still live is left alone", async () => {
    const { customerId } = await subscribed();
    const row = state.entitlements.get(OWNER)!;
    state.entitlements.set(OWNER, { ...row, status: "canceled", cancelAt: row.periodEnd });
    clock.set(new Date(Date.parse(row.periodEnd) + 4 * DAY).toISOString());
    expect(await reconcileSubscriptions(sandboxDeps())).toMatchObject({ checked: 1, ended: [] });
    expect(state.entitlements.get(OWNER)?.status).toBe("canceled");
    state.entitlements.set(OWNER, { ...row, stripeSubscriptionId: "sub_sandbox_77" });
    expect(await reconcileSubscriptions(sandboxDeps())).toMatchObject({ checked: 1, ended: [OWNER] });
    expect(customerId).toMatch(/^cus_sandbox_/);
  });

  it("ids of the other mode, a provider error or a row changed meanwhile are skipped, never ended", async () => {
    const { customerId } = await subscribed();
    await billing().endNow(customerId);
    const row = state.entitlements.get(OWNER)!;
    clock.set(new Date(Date.parse(row.periodEnd) + 4 * DAY).toISOString());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.entitlements.set(OWNER, { ...row, stripeCustomerId: "cus_Live1", stripeSubscriptionId: "sub_Live1" });
    expect(await reconcileSubscriptions(sandboxDeps())).toMatchObject({ checked: 1, ended: [] });
    state.entitlements.set(OWNER, row);
    const broken = { ...sandboxDeps(), integrations: { ...sandboxDeps().integrations, billing: Object.assign(Object.create(Object.getPrototypeOf(billing())), billing(), { subscription: async () => Promise.reject(new Error("stripe down")) }) } };
    expect(await reconcileSubscriptions(broken as never)).toMatchObject({ checked: 1, ended: [] });
    dbModule.listEntitlementsToReconcile.mockImplementationOnce(async () => [{ ...row, lastEventCreated: 1 }]);
    expect(await reconcileSubscriptions(sandboxDeps())).toMatchObject({ checked: 1, ended: [] });
    expect(state.entitlements.get(OWNER)?.status).toBe("active");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("BIL-2 entitlements-tick heals a plan grant whose invoice step never succeeded", () => {
  const HOUR = 3_600_000;
  const paid = (userId: string, startedHoursAgo: number, patch: Partial<Entitlement> = {}): Entitlement => ({
    ...trialEntitlement(userId, clock.now()),
    status: "active",
    planId: "pro",
    companyLimit: 3,
    monthlyCredits: 1000,
    priceUsd: 299,
    stripeCustomerId: `cus_${userId.slice(0, 4)}`,
    stripeSubscriptionId: `sub_${userId.slice(0, 4)}`,
    periodStart: new Date(clock.now().getTime() - startedHoursAgo * HOUR).toISOString(),
    periodEnd: new Date(clock.now().getTime() + 30 * 24 * HOUR).toISOString(),
    ...patch,
  });
  const grants = (userId: string) => (state.credits.get(userId) ?? []).filter((e) => e.kind === "grant_plan" && e.ref.startsWith("plan:"));
  const USERS = ["a1000000-0000-4000-8000-00000000000a", "b2000000-0000-4000-8000-00000000000b", "c3000000-0000-4000-8000-00000000000c", "d4000000-0000-4000-8000-00000000000d", "e5000000-0000-4000-8000-00000000000e"] as const;

  it(`a missing grant of an active, priced period at least ${HEAL_AFTER_HOURS} h old is written once under the invoice's ref; a second tick writes nothing`, async () => {
    const row = paid(OWNER, 25);
    state.entitlements.set(OWNER, row);
    expect(await healPlanGrants(deps())).toEqual({ checked: 1, healed: [OWNER] });
    expect(grants(OWNER).map((g) => [g.ref, g.amount])).toEqual([[`plan:${row.stripeSubscriptionId}:${row.periodStart}`, 1000]]);
    expect(await healPlanGrants(deps())).toEqual({ checked: 1, healed: [] });
    expect(grants(OWNER)).toHaveLength(1);
  });

  it("a period under 24 h, a past_due row, a trial, a $0 price and a period already granted are left alone", async () => {
    const [recent, pastDue, trialUser, free, granted] = USERS;
    for (const id of USERS) seedCompany(state, { id: `${id.slice(0, 8)}-0000-4000-8000-000000000999`, ownerId: id, slug: id.slice(0, 6), name: id.slice(0, 6) });
    state.entitlements.set(recent, paid(recent, 23));
    state.entitlements.set(pastDue, paid(pastDue, 48, { status: "past_due" }));
    state.entitlements.set(trialUser, { ...trialEntitlement(trialUser, new Date(clock.now().getTime() - 48 * HOUR)) });
    state.entitlements.set(free, paid(free, 48, { priceUsd: 0 }));
    const done = paid(granted, 48);
    state.entitlements.set(granted, done);
    state.credits.set(granted, [{ kind: "grant_plan", amount: 1000, ref: `plan:${done.stripeSubscriptionId}:${done.periodStart}`, note: "Pro credits for the period" }]);
    expect(await healPlanGrants(deps())).toEqual({ checked: 1, healed: [] });
    for (const id of USERS) expect(grants(id).length, id).toBe(id === granted ? 1 : 0);
  });

  it("a cancel-at-period-end row (canceled, its period still running) is healed; a canceled row whose period ended is not", async () => {
    const [running, over] = USERS;
    const runningRow = paid(running, 48, { status: "canceled", cancelAt: new Date(clock.now().getTime() + 20 * 24 * HOUR).toISOString() });
    state.entitlements.set(running, runningRow);
    state.entitlements.set(over, paid(over, 40 * 24, { status: "canceled", periodEnd: new Date(clock.now().getTime() - 2 * HOUR).toISOString(), cancelAt: new Date(clock.now().getTime() - 2 * HOUR).toISOString() }));
    expect(await healPlanGrants(deps())).toEqual({ checked: 1, healed: [running] });
    expect(grants(running).map((g) => g.ref)).toEqual([`plan:${runningRow.stripeSubscriptionId}:${runningRow.periodStart}`]);
    expect(grants(over)).toEqual([]);
  });

  it("a late invoice.paid of a healed period grants nothing: the ref is the same", async () => {
    const row = paid(OWNER, 30);
    state.entitlements.set(OWNER, row);
    await healPlanGrants(deps());
    const late = { kind: "grant_plan" as const, amount: 1000, ref: `plan:${row.stripeSubscriptionId}:${row.periodStart}`, note: "" };
    expect(await dbModule.insertCreditEntries({} as never, OWNER, [late])).toEqual([]);
    expect(grants(OWNER)).toHaveLength(1);
  });
});

describe("D6-8 resumeAllowed", () => {
  it("refuses while the entitlement is not active (subscription_ended) or the company is archived (retention); allows once a subscription is active again", async () => {
    await endSubscription(deps(), OWNER);
    state.entitlements.set(OWNER, entitlement({ status: "ended", endedAt: clock.now().toISOString(), retentionUntil: "2027-01-31T04:00:00.000Z" }));
    expect(await resumeAllowed(deps(), C1)).toEqual({ ok: false, reason: "subscription_ended" });
    state.entitlements.set(OWNER, entitlement({ status: "active", priceUsd: 299 }));
    await reactivate(deps(), OWNER);
    expect(await resumeAllowed(deps(), C1)).toEqual({ ok: true });
    state.archived.add(C2);
    state.pausedReasons.set(C2, "retention");
    expect(await resumeAllowed(deps(), C2)).toEqual({ ok: false, reason: "retention" });
  });
});
