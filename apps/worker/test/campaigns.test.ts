import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

/**
 * D4-3 campaigns: the kill switch pauses every active campaign within 5 s
 * even when one provider call hangs (BUD-4), resume opens exactly one K2
 * card, and the day roll resumes a daily-cap pause but never a total-cap one.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { killSwitchResumeCard, pauseForKillSwitch, resumeAfterDayRoll, KILL_PAUSE_TIMEOUT_MS } = await import("../src/services/campaigns");
const { completeAction, performPending } = await import("../src/services/actions");
const { settleDecision } = await import("../src/services/settle");

let events: SandboxEvent[];
let root: string;
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-campaigns-"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function campaign(deps: ReturnType<typeof fakeDeps>, name: string, status = "active", pausedDay: string | null = null) {
  const started = await deps.integrations.ads(null).startCampaign({ companyId: "company-1", name, dailyBudgetUsd: 10 });
  if (status !== "active") await deps.integrations.ads(null).pauseCampaign("company-1", started.campaignId);
  const row = await dbModule.registerCampaign(null, { companyId: "company-1", taskId: null, actionId: `action-${name}`, provider: "meta_ads", providerCampaignId: started.campaignId, name, metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50, status });
  if (pausedDay) await dbModule.setCampaignStatus(null, row.id, status, { pausedDay });
  return row;
}

describe("pauseForKillSwitch (BUD-4)", () => {
  it("pauses two active campaigns concurrently within 5 s on a slow adapter, records one K1 ads.pause with both ids, and marks the rows paused_kill", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const a = await campaign(deps, "A");
    const b = await campaign(deps, "B");
    const real = deps.integrations.ads(null);
    const slow = { ...deps.integrations, ads: () => ({ ...real, pauseCampaign: (companyId: string, id: string) => new Promise<void>((resolve) => setTimeout(() => void real.pauseCampaign(companyId, id).then(resolve), 2_000)) }) };
    const started = Date.now();
    const result = await pauseForKillSwitch({ ...deps, integrations: slow as typeof deps.integrations }, "company-1");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toEqual({ paused: [a.id, b.id], failed: [] });
    expect(state.campaigns.get(a.id)?.status).toBe("paused_kill");
    expect(state.campaigns.get(b.id)?.status).toBe("paused_kill");
    expect(await real.status("company-1", a.providerCampaignId)).toBe("paused");
    const heads = state.actions.filter((x) => !state.actions.some((y) => y.supersedes === x.id));
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({ kind: "ads.pause", tier: "K1", status: "notified", description: "Kill switch: paused 2 campaign(s)", payload: { campaignIds: [a.id, b.id], providerCampaignIds: [a.providerCampaignId, b.providerCampaignId] } });
  }, 10_000);

  it("a provider call that hangs is cut at 4 s: that campaign is recorded failed and keeps active with last_error, the other one is paused", async () => {
    vi.useFakeTimers();
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const a = await campaign(deps, "A");
    const b = await campaign(deps, "B");
    const real = deps.integrations.ads(null);
    const hanging = { ...deps.integrations, ads: () => ({ ...real, pauseCampaign: (_companyId: string, id: string) => (id === a.providerCampaignId ? new Promise<void>(() => {}) : Promise.resolve()) }) };
    const pending = pauseForKillSwitch({ ...deps, integrations: hanging as typeof deps.integrations }, "company-1");
    await vi.advanceTimersByTimeAsync(KILL_PAUSE_TIMEOUT_MS + 100);
    const result = await pending;
    expect(result).toEqual({ paused: [b.id], failed: [a.id] });
    expect(state.campaigns.get(a.id)).toMatchObject({ status: "active", lastError: expect.stringContaining("timed out") });
    expect(state.campaigns.get(b.id)?.status).toBe("paused_kill");
    const heads = state.actions.filter((x) => !state.actions.some((y) => y.supersedes === x.id));
    expect(heads.map((h) => [h.kind, h.status])).toEqual([
      ["ads.pause", "notified"],
      ["ads.pause", "failed"],
    ]);
    expect(heads[1]?.payload).toMatchObject({ campaignIds: [a.id] });
  });
});

describe("killSwitchResumeCard", () => {
  it("company/resume opens ONE K2 ads.resume card (requested tier K2, default decline) for every paused_kill campaign; a second resume reuses it; approve resumes both", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const a = await campaign(deps, "A", "paused_kill");
    const b = await campaign(deps, "B", "paused_kill");
    expect(await killSwitchResumeCard(deps, "company-1")).toMatchObject({ kind: "card", reused: false });
    expect(state.cards.size).toBe(1);
    const card = [...state.cards.values()][0]!;
    expect(card).toMatchObject({ tier: "K2", actionKind: "ads.resume", defaultOptionId: "decline", taskId: null });
    expect(card.question).toContain("Resume 2 campaign(s) paused by the kill switch");
    expect(await killSwitchResumeCard(deps, "company-1")).toEqual({ kind: "card", cardId: card.id, reused: true });
    expect(state.cards.size).toBe(1);
    expect(state.actions.filter((x) => x.kind === "ads.resume")).toHaveLength(1);

    Object.assign(card, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    const settlement = await settleDecision(deps, card.id);
    if (settlement.kind !== "perform") throw new Error(settlement.kind);
    const outcome = await performPending(deps, settlement.actionIds[0]!);
    expect(await completeAction(deps, { actionId: settlement.actionIds[0]!, tier: settlement.tier, outcome })).toMatchObject({ status: "executed" });
    expect(state.campaigns.get(a.id)?.status).toBe("active");
    expect(state.campaigns.get(b.id)?.status).toBe("active");
    expect(await deps.integrations.ads(null).status("company-1", a.providerCampaignId)).toBe("active");
    expect(await killSwitchResumeCard(deps, "company-1")).toEqual({ kind: "none" });
  });
});

describe("resumeAfterDayRoll (BUD-3)", () => {
  it("resumes a campaign paused for yesterday's daily cap (K1 ads.resume, notified), leaves today's pause alone, and never resumes while the total cap is reached", async () => {
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const old = await campaign(deps, "Old", "paused_cap", yesterday);
    await dbModule.setCampaignStatus(null, old.id, "paused_cap", { pausedDay: yesterday });
    Object.assign(state.campaigns.get(old.id)!, { taskId: task.id });
    const fresh = await campaign(deps, "Fresh", "paused_cap", today);
    expect(await resumeAfterDayRoll(deps, directSteps, "company-1", today)).toEqual([old.id]);
    expect(state.campaigns.get(old.id)).toMatchObject({ status: "active", pausedDay: null });
    expect(state.campaigns.get(fresh.id)).toMatchObject({ status: "paused_cap", pausedDay: today });
    const heads = state.actions.filter((x) => !state.actions.some((y) => y.supersedes === x.id));
    expect(heads.map((h) => [h.kind, h.tier, h.status, h.taskId])).toEqual([["ads.resume", "K1", "notified", task.id]]);
    expect(state.actions[0]?.payload).toMatchObject({ campaignId: old.id, reason: "day_roll" });

    await dbModule.setCampaignStatus(null, old.id, "paused_cap", { pausedDay: yesterday });
    state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 20, spentTotalUsd: 100, spentTodayUsd: 0 }]);
    expect(await resumeAfterDayRoll(deps, directSteps, "company-1", today)).toEqual([]);
    expect(state.campaigns.get(old.id)?.status).toBe("paused_cap");
  });
});
