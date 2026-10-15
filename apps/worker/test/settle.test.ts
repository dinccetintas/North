import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { adsStart, directSteps, emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

/**
 * D4-2 settlement: a batch card settles every pending send (approve performs
 * five, decline declines five), an approved cap raise resumes its campaign
 * through the gate, and the evidence a task finishes with is the campaign id
 * or the first message id, confirmed by the provider (AGT-2).
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { completeAction, gateAction, performPending } = await import("../src/services/actions");
const { finishTaskIfIdle, followUp, settleDecision } = await import("../src/services/settle");

let events: SandboxEvent[];
let root: string;
const today = new Date().toISOString().slice(0, 10);
const answer = (cardId: string, optionId: string) => Object.assign(state.cards.get(cardId)!, { answeredOptionId: optionId, answeredAt: new Date().toISOString(), answeredBy: "user" });

beforeEach(async () => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-settle-"));
});

async function fiveSends(taskId: string) {
  const deps = fakeDeps(state, events, 200, "sandbox", root);
  const leads = await dbModule.importLeads(null, "company-1", ["a", "b", "c", "d", "e"].map((n) => ({ name: n, email: `${n}@example.test` })), "upload");
  expect(leads.imported).toBe(5);
  const rows = await dbModule.nextUnsentLeads(null, "company-1", 5);
  const recipients = rows.map((l) => l.email);
  let cardId = "";
  for (const lead of rows) {
    const gated = await gateAction(deps, taskId, { kind: "email.send.first_contact", companyId: "x", agentRole: "x", description: `Email ${lead.email}`, payload: { batchId: `batch-${taskId}`, recipients, to: lead.email, subject: "s", text: "t", leadId: lead.id } });
    if (gated.kind !== "card") throw new Error(gated.kind);
    cardId = gated.cardId;
  }
  return { deps, cardId, rows };
}

/** The settle function's loop: perform and record every action of the card, then the follow-up. */
async function settleThrough(deps: ReturnType<typeof fakeDeps>, cardId: string) {
  const settlement = await settleDecision(deps, cardId);
  if (settlement.kind !== "perform") return settlement;
  for (const [i, actionId] of settlement.actionIds.entries()) {
    const outcome = await performPending(deps, actionId);
    const done = await completeAction(deps, { actionId, tier: settlement.tier, outcome });
    if (done.status === "executed") await followUp(deps, directSteps, actionId, i);
  }
  return settlement;
}

describe("settleDecision for a batch card (SLS-K2, DEC-3)", () => {
  it("approve performs all five sends, each with its own sandbox message id, marks the leads contacted and finishes the task with the first message id (AGT-2)", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch", result: { artifactIds: ["art-1"], costUsd: 0, summary: "batch" } });
    const { deps, cardId, rows } = await fiveSends(task.id);
    expect(state.cards.size).toBe(1);
    answer(cardId, "approve");
    const settlement = await settleThrough(deps, cardId);
    expect(settlement.kind).toBe("perform");
    const heads = state.actions.filter((a) => !state.actions.some((b) => b.supersedes === a.id));
    expect(heads.map((a) => a.status)).toEqual(["executed", "executed", "executed", "executed", "executed"]);
    expect(new Set(heads.map((a) => a.externalRef)).size).toBe(5);
    expect(heads.every((a) => a.externalRef?.startsWith("sandbox:msg:"))).toBe(true);
    expect(events.filter((e) => e.op === "send")).toHaveLength(5);
    for (const lead of rows) expect(state.leads.get(lead.id)).toMatchObject({ status: "contacted", batchId: `batch-${task.id}`, messageId: expect.stringMatching(/^sandbox:msg:/) });
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "done" });
    expect(state.tasks.get(task.id)?.evidence).toMatchObject({ kind: "message_id", ref: heads[0]?.externalRef, verified: true, sandbox: true });
  });

  it("decline declines all five, touches no mailbox, and the task still finishes on its artifact", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch", result: { artifactIds: ["art-1"], costUsd: 0, summary: "batch" } });
    const { deps, cardId } = await fiveSends(task.id);
    answer(cardId, "decline");
    const settlement = await settleThrough(deps, cardId);
    expect(settlement).toMatchObject({ kind: "declined", taskId: task.id });
    if (settlement.kind === "declined") expect(settlement.actionIds).toHaveLength(5);
    const heads = state.actions.filter((a) => !state.actions.some((b) => b.supersedes === a.id));
    expect(heads.map((a) => a.status)).toEqual(["declined", "declined", "declined", "declined", "declined"]);
    expect(events).toEqual([]);
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "done" });
    expect(state.tasks.get(task.id)?.evidence).toMatchObject({ kind: "artifact_id", ref: "art-1" });
    expect(await settleDecision(deps, cardId)).toEqual({ kind: "nothing", cardId });
  });
});

describe("cap card settlement (BUD-3)", () => {
  it("approve raises today's cap for the day and resumes the paused campaign through the gate (K1 ads.resume, notified)", async () => {
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const started = await deps.integrations.ads(null).startCampaign({ companyId: "company-1", name: "Launch test", dailyBudgetUsd: 10 });
    await deps.integrations.ads(null).pauseCampaign("company-1", started.campaignId);
    const campaign = await dbModule.registerCampaign(null, { companyId: "company-1", taskId: task.id, actionId: "action-0", provider: "meta_ads", providerCampaignId: started.campaignId, name: "Launch test", metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50, status: "paused_cap" });
    state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 11, spentTodayUsd: 11 }]);
    const gated = await gateAction(deps, task.id, { kind: "budget.cap.raise", companyId: "x", agentRole: "growth", description: "Today's ads cap ($10) is spent on Launch test ($11 so far). Raise today's cap by $10 and resume?", amountUsd: 10, category: "ads", payload: { campaignId: campaign.id, campaignName: "Launch test", resumeCampaignId: campaign.id, cap: "daily", day: today, spentUsd: 11, capUsd: 10 } });
    if (gated.kind !== "card") throw new Error(gated.kind);
    expect(state.cards.get(gated.cardId)).toMatchObject({ tier: "K2", actionKind: "budget.cap.raise", defaultOptionId: "decline" });
    answer(gated.cardId, "approve");
    await settleThrough(deps, gated.cardId);
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ dailyExtraUsd: 10 });
    const heads = state.actions.filter((a) => !state.actions.some((b) => b.supersedes === a.id));
    expect(heads.map((a) => [a.kind, a.tier, a.status])).toEqual([
      ["budget.cap.raise", "K2", "executed"],
      ["ads.resume", "K1", "notified"],
    ]);
    expect(heads[0]?.externalRef).toBe(`cap:ads:${today}:+10`);
    expect(state.campaigns.get(campaign.id)).toMatchObject({ status: "active", pausedDay: null });
    expect(await deps.integrations.ads(null).status("company-1", started.campaignId)).toBe("active");
    expect(events.map((e) => e.op)).toEqual(["startCampaign", "pauseCampaign", "resumeCampaign"]);
  });
});

describe("evidence (AGT-2)", () => {
  it("an executed ads.start finishes the task with the campaign id, verified by ads.status; a reference the provider does not know fails the task", async () => {
    const task = seedTask(state, { result: { artifactIds: [], costUsd: 0, summary: "spec" } });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const gated = await gateAction(deps, task.id, adsStart());
    if (gated.kind !== "card") throw new Error(gated.kind);
    answer(gated.cardId, "approve");
    await settleThrough(deps, gated.cardId);
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "done" });
    expect(state.tasks.get(task.id)?.evidence).toMatchObject({ kind: "campaign_id", ref: expect.stringMatching(/^sandbox:campaign:/), verified: true });

    const ghost = seedTask(state, { result: { artifactIds: [], costUsd: 0, summary: "" } });
    state.actions.push({ id: "ghost-1", companyId: "company-1", taskId: ghost.id, agentRole: "growth", kind: "ads.start", tier: "K2", description: "x", status: "executed", externalRef: "sandbox:campaign:does-not-exist", decisionCardId: "card-x", autoRuleId: null, sandbox: true, payload: {}, supersedes: null, createdAt: new Date().toISOString() });
    expect(await finishTaskIfIdle(deps, ghost.id)).toEqual({ status: "failed" });
    expect(state.tasks.get(ghost.id)?.status).toBe("failed");
  });
});
