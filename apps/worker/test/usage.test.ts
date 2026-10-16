import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUBSCRIPTION_PLANS, type Usage } from "@north/core";
import type { SandboxEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D6-3 (BIL-2, the 40 % NFR): `usage-tick` sends one `usage_alert` (push +
 * email) per user per owner-local month when inference plus sandbox cost
 * crosses 40 % of the plan price; none under the line; none on a trial
 * (price 0); a second tick in the same month sends nothing.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { notifyUsageAlert, usageTick } = await import("../src/services/usage");

const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const COMPANY = "c1000000-0000-4000-8000-000000000001";
const APP = "http://localhost:3100";
let clock: SimClock;
let events: SandboxEvent[];
const deps = () => fakeDeps(state, events, 200, "sandbox", "/tmp/north-test-sandbox", clock);
const usage = (period: string, llmCostUsd: number, sandboxMinutes = 0): Usage => ({ userId: OWNER, period, creditsUsed: 10, llmCostUsd, sandboxMinutes, alertedAt: null });
const subscribe = async () => {
  const trial = (await dbModule.getEntitlement({} as never, OWNER))!;
  const pro = SUBSCRIPTION_PLANS.pro;
  state.entitlements.set(OWNER, { ...trial, status: "active", planId: "pro", priceUsd: pro.priceUsd, companyLimit: pro.companyLimit, monthlyCredits: pro.monthlyCredits });
};
const alerts = () => (state.notifications as { kind: string; channel: string; payload: Record<string, unknown> }[]).filter((n) => n.kind === "usage_alert");

beforeEach(() => {
  Object.assign(state, emptyState());
  events = [];
  clock = new SimClock("2026-11-03T06:00:00.000Z");
  seedCompany(state, { id: COMPANY, ownerId: OWNER, timezone: "Europe/Istanbul" });
  state.pushSubscriptions = [{ endpoint: "https://push.example.test/a", p256dh: "p", auth: "a" }];
});

describe("D6-3 usage-tick", () => {
  it("$120 on Pro's $299 is 0.401: one alert for the period, marked; a second tick sends none", async () => {
    await subscribe();
    state.usage.set(`${OWNER}:2026-11`, usage("2026-11", 120));
    const due = await usageTick(deps());
    expect(due).toEqual([{ userId: OWNER, period: "2026-11", reason: "ratio", ratio: 0.401, costUsd: 120, priceUsd: 299 }]);
    expect(state.usage.get(`${OWNER}:2026-11`)?.alertedAt).toMatch(/^2026-11-03T06:00/);
    expect(await notifyUsageAlert(deps(), due[0]!, APP)).toEqual({ push: expect.any(Number), email: true });
    expect(alerts().map((n) => n.channel)).toEqual(["push", "email"]);
    expect(alerts()[0]?.payload).toMatchObject({ period: "2026-11", reason: "ratio", ratio: 0.401 });
    const mail = events.find((e) => e.provider === "mail");
    expect(String(mail?.payload.subject)).toContain("40 %");
    expect(mail?.payload).toMatchObject({ kind: "notification", to: "ceo@example.test" });
    expect(await usageTick(deps())).toEqual([]);
  });

  it("none under the line, none on a trial (price 0), none for a month that is not the owner's current one", async () => {
    state.usage.set(`${OWNER}:2026-11`, usage("2026-11", 500));
    expect(await usageTick(deps())).toEqual([]);
    await subscribe();
    state.usage.set(`${OWNER}:2026-11`, usage("2026-11", 100, 60));
    expect(await usageTick(deps())).toEqual([]);
    state.usage.set(`${OWNER}:2026-10`, usage("2026-10", 200));
    expect(await usageTick(deps())).toEqual([]);
    expect(state.usage.get(`${OWNER}:2026-10`)?.alertedAt).toBeNull();
  });

  it("sandbox minutes count: $119 of inference and 100 minutes cross the line", async () => {
    await subscribe();
    state.usage.set(`${OWNER}:2026-11`, usage("2026-11", 119, 100));
    expect((await usageTick(deps())).map((a) => a.ratio)).toEqual([0.401]);
  });

  it("zero credits: one usage_alert (credits_exhausted) per owner-local month, without claiming the 40 % alert; a second tick sends none; an ended owner gets none", async () => {
    await subscribe();
    state.credits.set(OWNER, []);
    const due = await usageTick(deps());
    expect(due).toEqual([{ userId: OWNER, period: "2026-11", reason: "credits_exhausted", ratio: 0, costUsd: 0, priceUsd: 299 }]);
    await notifyUsageAlert(deps(), due[0]!, APP);
    expect(alerts().map((n) => [n.channel, n.payload.reason])).toEqual([["push", "credits_exhausted"], ["email", "credits_exhausted"]]);
    expect(String(events.find((e) => e.provider === "mail")?.payload.subject)).toContain("waiting for credits");
    expect(await usageTick(deps())).toEqual([]);
    state.usage.set(`${OWNER}:2026-11`, usage("2026-11", 120));
    expect((await usageTick(deps())).map((a) => a.reason)).toEqual(["ratio"]);
    clock.set("2026-12-02T06:00:00.000Z");
    expect((await usageTick(deps())).map((a) => [a.reason, a.period])).toEqual([["credits_exhausted", "2026-12"]]);
    state.entitlements.set(OWNER, { ...state.entitlements.get(OWNER)!, status: "ended" });
    clock.set("2027-01-02T06:00:00.000Z");
    expect(await usageTick(deps())).toEqual([]);
  });
});
