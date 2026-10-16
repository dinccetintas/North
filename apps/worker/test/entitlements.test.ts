import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT, trialEntitlement, type Entitlement } from "@north/core";
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
