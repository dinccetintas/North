import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent, SandboxIntegrations } from "@north/integrations";
import type { CampaignRecord } from "@north/db";
import { adsStart, directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * M4 security review fixes (docs/plans/M4.md): campaign ids resolve through
 * the company's own rows and agents never resume (H1); a reply is bound to a
 * replied lead's thread (H2); a batch card's scope is the verified lead list
 * (H3); an approved card performs nothing under the kill switch (H4); a cap
 * raise for a day that is over fails instead of resuming (M1); a deferred cap
 * card is retried by the collector and stale deferred rows are never
 * re-dispatched (M2); the kill switch pauses paused_cap rows at the provider
 * (M4); a replayed window keeps the campaign's spent figures (L2).
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { performAction } = await import("../src/services/perform");
const { completeAction, gateAction, listDeferredRows, performPending } = await import("../src/services/actions");
const { followUp, settleDecision } = await import("../src/services/settle");
const { pauseForKillSwitch } = await import("../src/services/campaigns");
const { attributeWindow, collectCompanyMetrics } = await import("../src/services/collect-metrics");
const { unsettledAnsweredCards, deferredTaskIds } = await import("../src/services/kill-switch");

let events: SandboxEvent[];
let root: string;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const heads = () => state.actions.filter((x) => !state.actions.some((y) => y.supersedes === x.id));
const answer = (cardId: string, optionId: string) => Object.assign(state.cards.get(cardId)!, { answeredOptionId: optionId, answeredAt: new Date().toISOString(), answeredBy: "user" });

beforeEach(async () => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-hardening-"));
  // M6: budget days are the owner's, so the company and its (UTC) owner exist as they do in Postgres.
  seedCompany(state);
  seedCompany(state, { id: "company-2", ownerId: "user-2", slug: "other" });
});

async function campaign(deps: ReturnType<typeof fakeDeps>, name: string, status: string, companyId = "company-1", pausedAtProvider = status !== "active") {
  const started = await deps.integrations.ads(null).startCampaign({ companyId, name, dailyBudgetUsd: 10 });
  if (pausedAtProvider) await deps.integrations.ads(null).pauseCampaign(companyId, started.campaignId);
  return dbModule.registerCampaign(null, { companyId, taskId: null, actionId: `action-${name}`, provider: "meta_ads", providerCampaignId: started.campaignId, name, metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50, status });
}

const resume = (payload: Record<string, unknown>) => ({ kind: "ads.resume" as const, companyId: "company-1", agentRole: "growth", description: "Resume", payload });
const reply = (payload: Record<string, unknown>) => ({ kind: "email.send.reply" as const, companyId: "company-1", agentRole: "sales", description: "Re", payload: { to: "mara@example.test", subject: "Re", text: "t", ...payload } });
const firstContact = (payload: Record<string, unknown>) => ({ kind: "email.send.first_contact" as const, companyId: "company-1", agentRole: "sales", description: "Hi", payload: { to: "mara@example.test", subject: "Hi", text: "t", ...payload } });

async function lead(email: string, status = "new", messageId: string | null = null, companyId = "company-1") {
  await dbModule.importLeads(null, companyId, [{ name: email.split("@")[0] ?? email, email }], "upload");
  const row = [...state.leads.values()].find((l) => l.email === email && l.companyId === companyId)!;
  Object.assign(row, { status, messageId });
  return row;
}

describe("H1: campaign ids resolve through the company's rows; only the worker resumes", () => {
  it("a resume by provider id on a paused_kill row, with no card, is refused and the provider stays paused; an unknown id is refused", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const killed = await campaign(deps, "Killed", "paused_kill");
    await expect(performAction(deps, resume({ campaignId: killed.providerCampaignId, reason: "cap_raised" }))).rejects.toThrow(/refused/);
    await expect(performAction(deps, resume({ campaignId: killed.id }))).rejects.toThrow(/refused/);
    expect(await deps.integrations.ads(null).status("company-1", killed.providerCampaignId)).toBe("paused");
    await expect(performAction(deps, resume({ campaignId: "sandbox:campaign:not-ours" }))).rejects.toThrow(/not found/);
    await expect(performAction(deps, resume({ campaignId: "11111111-1111-4111-8111-111111111111" }))).rejects.toThrow(/not found/);
    state.budgets.set("company-2", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 0, spentTodayUsd: 0 }]);
    const foreign = await campaign(deps, "Foreign", "active", "company-2", false);
    await expect(performAction(deps, { kind: "ads.pause", companyId: "company-1", agentRole: "growth", description: "Pause", payload: { campaignId: foreign.providerCampaignId } })).rejects.toThrow(/not found/);
    expect(await deps.integrations.ads(null).status("company-2", foreign.providerCampaignId)).toBe("active");
    expect(events.filter((e) => e.op === "resumeCampaign" || e.op === "pauseCampaign").length).toBe(1);
  });

  it("the worker's own resume (paused_cap + day_roll/cap_raised) and a card-backed resume of paused_kill rows pass", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const capped = await campaign(deps, "Capped", "paused_cap");
    await expect(performAction(deps, resume({ campaignId: capped.id, reason: "day_roll" }))).resolves.toMatchObject({ externalRef: `resumed:${capped.providerCampaignId}` });
    const killed = await campaign(deps, "Killed", "paused_kill");
    await expect(performAction(deps, resume({ campaignIds: [killed.id], reason: "kill_switch" }), { decisionCardId: "card-1" })).resolves.toMatchObject({ externalRef: `resumed:${killed.providerCampaignId}` });
    await expect(performAction(deps, resume({ campaignIds: [capped.providerCampaignId], reason: "kill_switch" }))).rejects.toThrow(/refused/);
  });

  it("an agent-requested ads.resume (or budget.cap.raise) is blocked in the gate path and recorded as such", async () => {
    const task = seedTask(state);
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const gated = await gateAction(deps, task.id, resume({ campaignId: "sandbox:campaign:x", reason: "day_roll" }));
    expect(gated).toMatchObject({ kind: "blocked", reason: "worker_only" });
    expect(state.actions[0]).toMatchObject({ kind: "ads.resume", status: "blocked", payload: { worker_only: true } });
    const raise = await gateAction(deps, task.id, { kind: "budget.cap.raise", companyId: "x", agentRole: "growth", description: "Raise", amountUsd: 10, category: "ads", payload: { campaignId: "x", cap: "daily", day: today } });
    expect(raise).toMatchObject({ kind: "blocked", reason: "worker_only" });
    expect(state.cards.size).toBe(0);
  });
});

describe("H2: a reply is bound to a replied lead and its thread; support replies have no adapter", () => {
  it("refuses a reply without a replied lead of the company whose email is the recipient", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    await expect(performAction(deps, reply({}))).rejects.toThrow(/lead/);
    const fresh = await lead("mara@example.test", "new");
    await expect(performAction(deps, reply({ leadId: fresh.id }))).rejects.toThrow(/replied/);
    Object.assign(fresh, { status: "replied", messageId: "sandbox:msg:first" });
    await expect(performAction(deps, reply({ leadId: fresh.id, to: "other@example.test" }))).rejects.toThrow(/recipient/);
    const foreign = await lead("mara@example.test", "replied", "sandbox:msg:x", "company-2");
    await expect(performAction(deps, reply({ leadId: foreign.id }))).rejects.toThrow(/lead/);
    expect(events).toEqual([]);
  });

  it("sends the reply in the lead's thread (inReplyTo from the lead's message id, gmail refs parsed)", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const replied = await lead("mara@example.test", "replied", "sandbox:msg:first");
    const sent = await performAction(deps, reply({ leadId: replied.id }));
    expect(sent.externalRef).toMatch(/^sandbox:msg:/);
    expect(events[0]?.payload).toMatchObject({ kind: "reply", to: "mara@example.test", inReplyTo: { messageId: "sandbox:msg:first", threadId: "sandbox:msg:first" } });
    Object.assign(replied, { messageId: "gmail:m1:t1" });
    await performAction(deps, reply({ leadId: replied.id }));
    expect(events[1]?.payload).toMatchObject({ inReplyTo: { messageId: "m1", threadId: "t1" } });
  });

  it("support.reply.* are blocked no_adapter until a support inbox exists", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    expect(await gateAction(deps, task.id, { kind: "support.reply.template", companyId: "x", agentRole: "x", description: "Re", payload: { to: "a@example.test", subject: "s", text: "t" } })).toMatchObject({ kind: "blocked", reason: "no_adapter" });
    await expect(performAction(deps, { kind: "support.reply.custom", companyId: "company-1", agentRole: "sales", description: "Re", payload: { to: "a@example.test", subject: "s", text: "t" } })).rejects.toThrow(/No adapter/);
  });
});

describe("H3: a batch card's scope is the verified lead list", () => {
  const mail = (taskId: string, to: string, recipients: readonly string[], extra: Record<string, unknown> = {}) => ({ kind: "email.send.first_contact" as const, companyId: "x", agentRole: "x", description: `Email ${to}`, payload: { batchId: `batch-${taskId}`, recipients, to, subject: "s", text: "t", ...extra } });

  it("a sixth action with a new recipient, or one outside the card's list, is blocked batch_mismatch", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const recipients = ["a", "b", "c", "d", "e"].map((n) => `${n}@example.test`);
    for (const r of recipients) await lead(r);
    for (const to of recipients) expect((await gateAction(deps, task.id, mail(task.id, to, recipients))).kind).toBe("card");
    expect(state.cards.size).toBe(1);
    const sixth = await gateAction(deps, task.id, mail(task.id, "f@example.test", [...recipients, "f@example.test"]));
    expect(sixth).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(state.actions.at(-1)).toMatchObject({ status: "blocked", payload: { batch_mismatch: true } });
    expect(state.actions.filter((a) => a.status === "pending")).toHaveLength(5);
    expect(state.cards.size).toBe(1);
  });

  it("a recipient list with an address that is not a lead of the company refuses the whole batch before a card opens", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    await lead("a@example.test");
    await lead("b@example.test", "new", null, "company-2");
    const gated = await gateAction(deps, task.id, mail(task.id, "a@example.test", ["a@example.test", "b@example.test"]));
    expect(gated).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(state.cards.size).toBe(0);
    expect((await gateAction(deps, task.id, mail(task.id, "a@example.test", ["a@example.test"]))).kind).toBe("card");
    expect(state.cards.size).toBe(1);
  });

  it("a first contact is sent only to a new lead of the company named by leadId whose email is the recipient", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    await expect(performAction(deps, firstContact({}))).rejects.toThrow(/lead/);
    const contacted = await lead("mara@example.test", "contacted");
    await expect(performAction(deps, firstContact({ leadId: contacted.id }))).rejects.toThrow(/new/);
    const fresh = await lead("fresh@example.test");
    await expect(performAction(deps, firstContact({ leadId: fresh.id }))).rejects.toThrow(/recipient/);
    await expect(performAction(deps, firstContact({ leadId: fresh.id, to: "fresh@example.test" }))).resolves.toMatchObject({ sandbox: true });
    expect(events).toHaveLength(1);
  });
});

describe("H4: nothing is performed under the kill switch, even for an approved card", () => {
  it("settle under the kill switch leaves the action pending; resume re-settles it", async () => {
    const task = seedTask(state);
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const gated = await gateAction(deps, task.id, adsStart());
    if (gated.kind !== "card") throw new Error(gated.kind);
    answer(gated.cardId, "approve");
    state.killSwitch.set("company-1", true);
    const settlement = await settleDecision(deps, gated.cardId);
    if (settlement.kind !== "perform") throw new Error(settlement.kind);
    const outcome = await performPending(deps, settlement.actionIds[0]!);
    expect(outcome).toEqual({ ok: false, error: "kill switch active", killed: true });
    expect(await completeAction(deps, { actionId: settlement.actionIds[0]!, tier: settlement.tier, outcome })).toEqual({ status: "pending", externalRef: null });
    expect(heads().map((a) => a.status)).toEqual(["pending"]);
    expect(events).toEqual([]);
    expect(await unsettledAnsweredCards(deps, "company-1")).toEqual([{ cardId: gated.cardId, optionId: "approve", answeredBy: "user" }]);
    state.killSwitch.set("company-1", false);
    const again = await performPending(deps, settlement.actionIds[0]!);
    expect(again.ok).toBe(true);
    expect(await completeAction(deps, { actionId: settlement.actionIds[0]!, tier: settlement.tier, outcome: again })).toMatchObject({ status: "executed" });
    expect(events.map((e) => e.op)).toEqual(["startCampaign"]);
  });
});

describe("M1: a cap raise for a day that is over fails and resumes nothing", () => {
  it("records the action failed ('cap day is over') and the follow-up resumes nothing", async () => {
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const capped = await campaign(deps, "Capped", "paused_cap");
    state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 11, spentTodayUsd: 0, dailyExtraDate: tomorrow }]);
    const gated = await gateAction(deps, task.id, { kind: "budget.cap.raise", companyId: "x", agentRole: "growth", description: "Raise today's cap by $10 and resume?", amountUsd: 10, category: "ads", payload: { campaignId: capped.id, resumeCampaignId: capped.id, cap: "daily", day: today, spentUsd: 11, capUsd: 10 } }, { origin: "worker" });
    if (gated.kind !== "card") throw new Error(gated.kind);
    answer(gated.cardId, "approve");
    const settlement = await settleDecision(deps, gated.cardId);
    if (settlement.kind !== "perform") throw new Error(settlement.kind);
    const outcome = await performPending(deps, settlement.actionIds[0]!);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/cap day is over/) });
    const done = await completeAction(deps, { actionId: settlement.actionIds[0]!, tier: settlement.tier, outcome });
    expect(done).toMatchObject({ status: "failed" });
    // The settle loop runs the follow-up for executed raises only; a failed raise resumes nothing.
    if (done.status === "executed") await followUp(deps, directSteps, settlement.actionIds[0]!, 0);
    expect(heads().map((a) => [a.kind, a.status])).toEqual([["budget.cap.raise", "failed"]]);
    expect(state.campaigns.get(capped.id)?.status).toBe("paused_cap");
    expect(state.budgets.get("company-1")?.[0]?.dailyExtraUsd ?? 0).toBe(0);
    expect(events.map((e) => e.op)).toEqual(["startCampaign", "pauseCampaign"]);
  });
});

describe("M2: a quota-deferred cap card is retried by the collector; stale deferred rows are never re-dispatched", () => {
  it("deferred at the cap → the next collection opens the card once the quota is back, and only once", async () => {
    const task = seedTask(state, { status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const started = await deps.integrations.ads(null).startCampaign({ companyId: "company-1", name: "Acme", dailyBudgetUsd: 10 });
    const row = await dbModule.registerCampaign(null, { companyId: "company-1", taskId: task.id, actionId: "action-start", provider: "meta_ads", providerCampaignId: started.campaignId, name: "Acme", metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50 });
    await deps.integrations.ads(null).insights("company-1", started.campaignId);
    await (deps.integrations as SandboxIntegrations).sandbox.ads.deliver(started.campaignId, { spendUsd: 11, impressions: 2000, clicks: 30, conversions: 2 });
    state.quotaExhausted = true;
    const first = await collectCompanyMetrics(deps, directSteps, "company-1", "manual");
    expect(first).toMatchObject({ paused: [row.id], cardsOpened: [] });
    expect(state.cards.size).toBe(0);
    expect(heads().map((a) => [a.kind, a.status])).toEqual([["ads.pause", "notified"], ["budget.cap.raise", "blocked"]]);
    expect((await collectCompanyMetrics(deps, directSteps, "company-1", "manual")).cardsOpened).toEqual([]);
    state.quotaExhausted = false;
    const second = await collectCompanyMetrics(deps, directSteps, "company-1", "manual");
    expect(second.cardsOpened).toHaveLength(1);
    expect(state.cards.get(second.cardsOpened[0]!)).toMatchObject({ actionKind: "budget.cap.raise", defaultOptionId: "decline" });
    expect((await collectCompanyMetrics(deps, directSteps, "company-1", "manual")).cardsOpened).toEqual([]);
    expect(state.cards.size).toBe(1);
    // One live card row; the two deferred rows were retired ("retried") and none still waits for the quota.
    expect(heads().filter((a) => a.kind === "budget.cap.raise" && a.status === "pending")).toHaveLength(1);
    expect(heads().filter((a) => a.payload.quota_deferred === true)).toEqual([]);
  });

  it("a deferred row whose task is done or failed is superseded 'stale' and not re-dispatched", async () => {
    const task = seedTask(state);
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    state.quotaExhausted = true;
    await gateAction(deps, task.id, adsStart());
    state.tasks.get(task.id)!.status = "done";
    expect(await listDeferredRows(deps.db)).toEqual([]);
    expect(state.actions.at(-1)).toMatchObject({ status: "blocked", supersedes: state.actions[0]?.id, payload: { note: "stale" } });
    expect(await deferredTaskIds(deps)).toEqual([]);
    expect(state.actions).toHaveLength(2);
  });
});

describe("M4: the kill switch pauses every delivering row at the provider", () => {
  it("a paused_cap row whose provider still delivers is paused within the SLA and keeps paused_cap with its day", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const active = await campaign(deps, "Active", "active");
    const capped = await campaign(deps, "Capped", "paused_cap", "company-1", false);
    await dbModule.setCampaignStatus(null, capped.id, "paused_cap", { pausedDay: today });
    const ended = await campaign(deps, "Ended", "ended");
    const started = Date.now();
    const result = await pauseForKillSwitch(deps, "company-1");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toEqual({ paused: [active.id, capped.id], failed: [] });
    expect(await deps.integrations.ads(null).status("company-1", capped.providerCampaignId)).toBe("paused");
    expect(state.campaigns.get(active.id)?.status).toBe("paused_kill");
    expect(state.campaigns.get(capped.id)).toMatchObject({ status: "paused_cap", pausedDay: today });
    expect(state.campaigns.get(ended.id)?.status).toBe("ended");
    expect(heads()[0]).toMatchObject({ kind: "ads.pause", tier: "K1", status: "notified", payload: { campaignIds: [active.id, capped.id] } });
    expect(events.filter((e) => e.op === "pauseCampaign").map((e) => e.ref)).toEqual(expect.arrayContaining([active.providerCampaignId, capped.providerCampaignId]));
  });
});

describe("L2: a replayed window keeps the campaign's spent figures", () => {
  it("attributing the same insights twice from the pre-update row leaves spent_today and spent_total as after the first write", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const row = (await campaign(deps, "Acme", "active")) as unknown as CampaignRecord;
    const insights = { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1, asOf: new Date().toISOString(), sandbox: true };
    const first = await attributeWindow(deps, row, insights, today);
    expect(first.campaign).toMatchObject({ spentTodayUsd: 4, spentTotalUsd: 4, clicks: 12 });
    const replay = await attributeWindow(deps, row, insights, today);
    expect(replay.duplicate).toBe(true);
    expect(replay.campaign).toMatchObject({ spentTodayUsd: 4, spentTotalUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ spentTodayUsd: 4, spentTotalUsd: 4 });
  });
});
