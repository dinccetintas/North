import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDay } from "@north/core";
import type { SandboxEvent, SandboxIntegrations } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * D4-4 the collector on the sandbox adapters (OUT-1, OUT-2, BUD-1, BUD-3):
 * $4 + $4 → two ledger entries and $8 spent, no card; +$3 → the campaign is
 * paused (ads.pause, notified) and one K2 cap card opens with default
 * decline; a second collection opens no second card; approve → today's extra
 * +$10 and ads.resume (notified); a replayed window writes nothing.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { collectCompanyMetrics } = await import("../src/services/collect-metrics");
const { completeAction, performPending } = await import("../src/services/actions");
const { followUp, settleDecision } = await import("../src/services/settle");

let events: SandboxEvent[];
let root: string;
const today = new Date().toISOString().slice(0, 10);
const heads = () => state.actions.filter((x) => !state.actions.some((y) => y.supersedes === x.id));
const ledger = () => state.ledger as { channel: string; metricKey: string; before: number; after: number; costUsd: number; provenance: { raw?: Record<string, unknown>; campaignId?: string } }[];

beforeEach(async () => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-collect-"));
  // M6: budget days are the owner's, so the company and its (UTC) owner exist as they do in Postgres.
  seedCompany(state);
});

async function activeCampaign(deps: ReturnType<typeof fakeDeps>, taskId: string) {
  const started = await deps.integrations.ads(null).startCampaign({ companyId: "company-1", name: "Acme launch test", dailyBudgetUsd: 10, audience: "solo consultants" });
  return dbModule.registerCampaign(null, { companyId: "company-1", taskId, actionId: "action-start", provider: "meta_ads", providerCampaignId: started.campaignId, name: "Acme launch test", metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50 });
}

const sandboxOf = (deps: ReturnType<typeof fakeDeps>) => (deps.integrations as SandboxIntegrations).sandbox;
const collect = (deps: ReturnType<typeof fakeDeps>, reason: "manual" | "cron" = "manual") => collectCompanyMetrics(deps, directSteps, "company-1", reason);

describe("collectCompanyMetrics (OUT-1/OUT-2, BUD-1/BUD-3)", () => {
  it("attributes each delivery window to the ledger with provenance, applies the spend, pauses and asks at the 11th dollar, asks once, resumes on approve, and ignores a replay", async () => {
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const campaign = await activeCampaign(deps, task.id);
    const sandbox = sandboxOf(deps);

    // $4 → one entry: signups 0 → 1 at a cost of $4, clicks in the provenance; spend on the budget; company signups from sandbox analytics.
    await sandbox.ads.deliver(campaign.providerCampaignId, { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    const first = await collect(deps);
    expect(first).toMatchObject({ campaigns: 1, entries: 1, paused: [], cardsOpened: [], analytics: true, payments: false });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ channel: "meta_ads", metricKey: "signups", before: 0, after: 1, costUsd: 4, provenance: { campaignId: campaign.providerCampaignId, raw: { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 } } });
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ spentTodayUsd: 4, spentTotalUsd: 4 });
    expect(state.channelSamples.map((s) => [s.metricKey, s.value])).toEqual(expect.arrayContaining([["ad_spend_usd", 4], ["ad_clicks", 12], ["ad_impressions", 800], ["signups", 1]]));
    expect(state.metrics.find((m) => m.metricKey === "signups")).toMatchObject({ value: 1, source: "sandbox_analytics" });
    expect(state.campaigns.get(campaign.id)).toMatchObject({ status: "active", spentTodayUsd: 4, spentTotalUsd: 4, clicks: 12, conversions: 1 });

    // $4 more → a second entry, $8 today, still no card.
    await sandbox.ads.deliver(campaign.providerCampaignId, { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    expect((await collect(deps)).entries).toBe(1);
    expect(ledger()).toHaveLength(2);
    expect(ledger()[1]).toMatchObject({ before: 1, after: 2, costUsd: 4 });
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ spentTodayUsd: 8 });
    expect(state.cards.size).toBe(0);

    // $3 more → $11 > $10: paused for the cap (K1 ads.pause through the gate, notified) and one K2 cap card, default decline.
    await sandbox.ads.deliver(campaign.providerCampaignId, { spendUsd: 3, impressions: 600, clicks: 9, conversions: 1 });
    const third = await collect(deps);
    expect(third).toMatchObject({ entries: 1, paused: [campaign.id] });
    expect(third.cardsOpened).toHaveLength(1);
    expect(state.campaigns.get(campaign.id)).toMatchObject({ status: "paused_cap", pausedDay: today });
    expect(await deps.integrations.ads(null).status("company-1", campaign.providerCampaignId)).toBe("paused");
    expect(heads().map((h) => [h.kind, h.tier, h.status])).toEqual([
      ["ads.pause", "K1", "notified"],
      ["budget.cap.raise", "K2", "pending"],
    ]);
    const card = state.cards.get(third.cardsOpened[0]!)!;
    expect(card).toMatchObject({ tier: "K2", actionKind: "budget.cap.raise", defaultOptionId: "decline", taskId: task.id });
    expect(card.question).toContain("Raise today's cap by $10 and resume?");
    expect(card.rationale).toContain("spent $11 of $10 today");
    expect(card.rationale).toContain("campaign: Acme launch test");

    // A second collection: nothing new, no second card.
    const again = await collect(deps);
    expect(again).toMatchObject({ entries: 0, paused: [], cardsOpened: [] });
    expect(state.cards.size).toBe(1);
    expect(ledger()).toHaveLength(3);

    // Approve → today's cap +$10, ads.resume (K1, notified) through the gate, campaign active again.
    Object.assign(card, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    const settlement = await settleDecision(deps, card.id);
    if (settlement.kind !== "perform") throw new Error(settlement.kind);
    const outcome = await performPending(deps, settlement.actionIds[0]!);
    const done = await completeAction(deps, { actionId: settlement.actionIds[0]!, tier: settlement.tier, outcome });
    expect(done).toMatchObject({ status: "executed", externalRef: `cap:ads:${today}:+10` });
    expect(await followUp(deps, directSteps, settlement.actionIds[0]!, 0)).toEqual({ kind: "resumed", campaignId: campaign.id });
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ dailyExtraUsd: 10, spentTodayUsd: 11 });
    expect(state.campaigns.get(campaign.id)?.status).toBe("active");
    expect(heads().map((h) => [h.kind, h.status])).toEqual([
      ["ads.pause", "notified"],
      ["budget.cap.raise", "executed"],
      ["ads.resume", "notified"],
    ]);

    // Replay: the same windows again write nothing.
    const replay = await collect(deps);
    expect(replay).toMatchObject({ entries: 0, cardsOpened: [] });
    expect(ledger()).toHaveLength(3);
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ spentTodayUsd: 11, spentTotalUsd: 11 });
  });

  it("a declined cap card keeps the campaign paused and no new card opens for the same cap level that day; a later breach of a raised cap asks again", async () => {
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const campaign = await activeCampaign(deps, task.id);
    const sandbox = sandboxOf(deps);
    await sandbox.ads.deliver(campaign.providerCampaignId, { spendUsd: 11, impressions: 2000, clicks: 30, conversions: 2 });
    const first = await collect(deps);
    expect(first.cardsOpened).toHaveLength(1);
    const card = state.cards.get(first.cardsOpened[0]!)!;
    Object.assign(card, { answeredOptionId: "decline", answeredAt: new Date().toISOString(), answeredBy: "user" });
    expect((await settleDecision(deps, card.id)).kind).toBe("declined");
    expect((await collect(deps)).cardsOpened).toEqual([]);
    expect(state.campaigns.get(campaign.id)?.status).toBe("paused_cap");
    expect(state.cards.size).toBe(1);
    // The CEO raised the cap in settings: the same campaign may ask again once the new cap is reached.
    state.budgets.get("company-1")![0]!.dailyLimitUsd = 20;
    await dbModule.setCampaignStatus(null, campaign.id, "active", { pausedDay: null });
    await deps.integrations.ads(null).resumeCampaign("company-1", campaign.providerCampaignId);
    await sandbox.ads.deliver(campaign.providerCampaignId, { spendUsd: 10, impressions: 2000, clicks: 30, conversions: 1 });
    const second = await collect(deps);
    expect(second.cardsOpened).toHaveLength(1);
    expect(state.cards.get(second.cardsOpened[0]!)?.rationale).toContain("spent $21 of $20 today");
    expect(state.cards.size).toBe(2);
  });

  it("the hourly cron paces sandbox campaigns (one simulated hour) and a manual collection does not; a campaign with no deliveries writes nothing", async () => {
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const campaign = await activeCampaign(deps, task.id);
    expect((await collect(deps, "manual")).entries).toBe(0);
    expect(ledger()).toHaveLength(0);
    const cron = await collect(deps, "cron");
    expect(cron.entries).toBe(1);
    expect(events.some((e) => e.op === "pace")).toBe(true);
    const insights = await deps.integrations.ads(null).insights("company-1", campaign.providerCampaignId);
    expect(insights.spendUsd).toBeCloseTo(10 / 24, 2);
    expect(state.budgets.get("company-1")?.[0]?.spentTodayUsd).toBeCloseTo(10 / 24, 2);
  });
});

describe("D6-9 budgets on the owner-local day (ADR 0011 follow-up)", () => {
  it("an Istanbul owner at 23:30 local spends on today's Istanbul date; at 00:30 local the day has rolled although UTC has not; the cap card day matches the decision card day", async () => {
    Object.assign(state, { ...emptyState(), budgets: state.budgets });
    seedCompany(state, { timezone: "Europe/Istanbul" });
    const clock = new SimClock("2026-11-03T20:30:00.000Z"); // 23:30 on 3 November in Istanbul
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root, clock);
    const campaign = await activeCampaign(deps, task.id);
    const sandbox = sandboxOf(deps);
    dbModule.recordAttributionWindow.mockClear();
    const days = () => dbModule.recordAttributionWindow.mock.calls.map((call) => (call[1] as unknown as { day: string }).day);

    await sandbox.ads.deliver(campaign.providerCampaignId, { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    await collect(deps);
    expect(days()).toEqual(["2026-11-03"]);

    clock.set("2026-11-03T21:30:00.000Z"); // 00:30 on 4 November in Istanbul; UTC is still the 3rd
    await sandbox.ads.deliver(campaign.providerCampaignId, { spendUsd: 11, impressions: 900, clicks: 14, conversions: 1 });
    const rolled = await collect(deps);
    expect(days()).toEqual(["2026-11-03", "2026-11-04"]);
    expect(state.campaigns.get(campaign.id)).toMatchObject({ status: "paused_cap", pausedDay: "2026-11-04" });
    expect(rolled.cardsOpened).toHaveLength(1);
    const card = state.cards.get(rolled.cardsOpened[0]!)!;
    const capAction = state.actions.find((a) => a.kind === "budget.cap.raise")!;
    expect(capAction.payload.day).toBe("2026-11-04");
    expect(localDay("Europe/Istanbul", new Date(card.openedAt))).toBe(capAction.payload.day);
    expect(card.question).toContain("Raise today's cap");
  });
});
