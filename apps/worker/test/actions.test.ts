import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { adsStart, emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { completeAction, deferredActionsFor, gateAction, performPending } = await import("../src/services/actions");
const { performAction } = await import("../src/services/perform");
const { applyOverdueDefaults, finishTaskIfIdle, settleDecision } = await import("../src/services/settle");
const { notifyDecision, cardUrl } = await import("../src/services/notify");
const { deferredTaskIds, unsettledAnsweredCards } = await import("../src/services/kill-switch");

const adsBudget = { category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 };

let events: SandboxEvent[];

beforeEach(() => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [adsBudget]);
  events = [];
});

/** Runs the three durable steps the Inngest function runs for an `execute` decision. */
async function executeThrough(taskId: string, spec = adsStart()) {
  const deps = fakeDeps(state, events);
  const gated = await gateAction(deps, taskId, spec);
  if (gated.kind !== "execute") return { gated, completed: null };
  const outcome = await performPending(deps, gated.actionId);
  const completed = await completeAction(deps, { actionId: gated.actionId, tier: gated.tier, outcome });
  return { gated, completed };
}

/** A lead of company-1 in the given status (H2/H3: every send names its lead). */
async function seedLead(email: string, status = "new", messageId: string | null = null) {
  await dbModule.importLeads(null, "company-1", [{ name: email, email }], "upload");
  const lead = [...state.leads.values()].find((l) => l.email === email)!;
  Object.assign(lead, { status, messageId });
  return lead;
}

/** Opens a K2 card for a task and returns the ids the settle path needs. */
async function openCardFor(taskId: string, spec = adsStart()) {
  const gated = await gateAction(fakeDeps(state, events), taskId, spec);
  if (gated.kind !== "card") throw new Error(`expected a card, got ${gated.kind}`);
  return gated;
}

describe("performAction", () => {
  it("routes ads.start to the ads adapter, capped at the gated amount, and reports the sandbox flag from the adapter", async () => {
    const result = await performAction(fakeDeps(state, events), adsStart({ amountUsd: 5 }));
    expect(result).toMatchObject({ sandbox: true });
    expect(result.externalRef).toMatch(/^sandbox:campaign:/);
    expect(events[0]).toMatchObject({ provider: "ads", op: "startCampaign", payload: { dailyBudgetUsd: 5 } });
  });

  it("routes first-contact email to the user's own outreach mailbox, never the platform mail provider (ADR 0010)", async () => {
    const lead = await seedLead("mara@example.test");
    const result = await performAction(fakeDeps(state, events), { kind: "email.send.first_contact", companyId: "company-1", agentRole: "sales", description: "Hello", payload: { to: "mara@example.test", subject: "Hi", text: "Body", leadId: lead.id } });
    expect(result.externalRef).toMatch(/^sandbox:msg:/);
    expect(events[0]).toMatchObject({ provider: "outreach", payload: { to: "mara@example.test", kind: "first_contact" } });
  });

  it("throws for kinds without an adapter instead of inventing a reference", async () => {
    await expect(performAction(fakeDeps(state, events), { kind: "social.publish", companyId: "company-1", agentRole: "growth", description: "Post" })).rejects.toThrow(/No adapter/);
    expect(events).toEqual([]);
  });
});

describe("gateAction (DEC-1 through AuthorityEngine.gate)", () => {
  it("K0 internal work is recorded executed without an adapter", async () => {
    const task = seedTask(state, { role: "research", taskType: "market_report" });
    const gated = await gateAction(fakeDeps(state, events), task.id, { kind: "research", companyId: "x", agentRole: "x", description: "Search the market" });
    expect(gated).toMatchObject({ kind: "executed", externalRef: "internal" });
    expect(state.actions[0]).toMatchObject({ kind: "research", tier: "K0", status: "executed", taskId: task.id, companyId: "company-1" });
  });

  it("K1 actions are recorded pending, performed in a separate step, then recorded notified with their reference", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const lead = await seedLead("a@example.test", "replied", "sandbox:msg:first");
    const { gated, completed } = await executeThrough(task.id, { kind: "email.send.reply", companyId: "x", agentRole: "x", description: "Reply", payload: { to: "a@example.test", subject: "Re", text: "t", leadId: lead.id } });
    expect(gated).toMatchObject({ kind: "execute", tier: "K1" });
    expect(completed).toMatchObject({ status: "notified", externalRef: expect.stringMatching(/^sandbox:msg:/) });
    expect(state.actions.map((a) => a.status)).toEqual(["pending", "notified"]);
    expect(state.actions[1]?.supersedes).toBe(state.actions[0]?.id);
    expect(state.tasks.get(task.id)?.status).toBe("running");
  });

  it("external kinds without an adapter are blocked, never faked as executed (AGT-2)", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site" });
    const gated = await gateAction(fakeDeps(state, events), task.id, { kind: "social.publish", companyId: "x", agentRole: "x", description: "Post it" });
    expect(gated).toMatchObject({ kind: "blocked", reason: "no_adapter" });
    expect(state.actions[0]).toMatchObject({ status: "blocked", payload: { no_adapter: true } });
  });

  it("K2 ads.start opens a card, records a pending action tied to it and parks the task", async () => {
    const task = seedTask(state);
    const gated = await openCardFor(task.id);
    expect(state.cards.get(gated.cardId)).toMatchObject({ tier: "K2", actionKind: "ads.start", taskId: task.id, defaultOptionId: "decline" });
    expect(state.actions[0]).toMatchObject({ id: gated.actionId, status: "pending", tier: "K2", decisionCardId: gated.cardId, payload: { gate: "card", spec: expect.objectContaining({ kind: "ads.start" }) } });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
    expect(events).toEqual([]);
  });

  it("a task with several card actions parks once and opens one card per action (no illegal transition)", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    // SLS-K2: a single first contact goes to a free new lead of the company, like a batch's first send.
    for (const r of ["a@example.test", "b@example.test"]) await seedLead(r);
    const mail = (to: string) => ({ kind: "email.send.first_contact" as const, companyId: "x", agentRole: "x", description: `Email ${to}`, payload: { to, subject: "s", text: "t" } });
    const first = await openCardFor(task.id, mail("a@example.test"));
    const second = await openCardFor(task.id, mail("b@example.test"));
    expect(first.cardId).not.toBe(second.cardId);
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
  });

  it("DEC-3 / SLS-K2: five first-contact sends of one batch open ONE card and five pending rows on it", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const recipients = ["a", "b", "c", "d", "e"].map((n) => `${n}@example.test`);
    for (const r of recipients) await seedLead(r);
    const mail = (to: string) => ({ kind: "email.send.first_contact" as const, companyId: "x", agentRole: "x", description: `Email ${to}`, payload: { batchId: `batch-${task.id}`, recipients, to, subject: "s", text: "t" } });
    const gated: Awaited<ReturnType<typeof openCardFor>>[] = [];
    for (const to of recipients) gated.push(await openCardFor(task.id, mail(to)));
    expect(new Set(gated.map((g) => g.cardId)).size).toBe(1);
    expect(new Set(gated.map((g) => g.actionId)).size).toBe(5);
    expect(state.cards.size).toBe(1);
    expect(state.cards.get(gated[0]!.cardId)).toMatchObject({ question: "Send 5 first-contact emails?", tier: "K2", actionKind: "email.send.first_contact" });
    expect(state.actions.filter((a) => a.status === "pending" && a.decisionCardId === gated[0]!.cardId)).toHaveLength(5);
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
    // Gating the same send again reuses its own row, not a sixth one.
    expect((await openCardFor(task.id, mail("a@example.test"))).actionId).toBe(gated[0]!.actionId);
    expect(state.actions).toHaveLength(5);
  });

  it("gating the same spec twice reuses the pending action and card (idempotent under step retries)", async () => {
    const task = seedTask(state);
    const first = await openCardFor(task.id);
    const again = await openCardFor(task.id);
    expect(again).toEqual(first);
    expect(state.cards.size).toBe(1);
    expect(state.actions).toHaveLength(1);
  });

  it("never lets an agent lower its tier: a requested K0 on ads.start still opens a card", async () => {
    const task = seedTask(state);
    expect((await gateAction(fakeDeps(state, events), task.id, adsStart({ requestedTier: "K0" }))).kind).toBe("card");
  });

  it("a matching auto rule runs the K2 action without a card and records the rule", async () => {
    const task = seedTask(state);
    state.autoRules.set("company-1", [{ id: "rule-1", kind: "ads.start", maxAmountUsd: 100, category: "ads", active: true }]);
    const { gated, completed } = await executeThrough(task.id, adsStart({ amountUsd: 15 }));
    expect(gated).toMatchObject({ kind: "execute", tier: "K2" });
    expect(completed).toMatchObject({ status: "executed" });
    expect(state.actions[0]).toMatchObject({ status: "pending", autoRuleId: "rule-1" });
    expect(state.actions[1]).toMatchObject({ status: "executed", externalRef: expect.stringMatching(/^sandbox:campaign:/) });
    expect(state.cards.size).toBe(0);
  });

  it("a provider failure is recorded as failed on the action, after the pending row exists", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const lead = await seedLead("a@example.test", "replied", "sandbox:msg:first");
    const { completed } = await executeThrough(task.id, { kind: "email.send.reply", companyId: "x", agentRole: "x", description: "Reply", payload: { to: "a@example.test", subject: "", text: "t", leadId: lead.id } });
    expect(completed).toMatchObject({ status: "failed", externalRef: null });
    expect(state.actions.map((a) => a.status)).toEqual(["pending", "failed"]);
  });

  it("DEC-3: when the quota is spent the action is deferred, not dropped", async () => {
    const task = seedTask(state);
    state.quotaExhausted = true;
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    expect(gated.kind).toBe("deferred");
    expect(state.actions[0]).toMatchObject({ status: "blocked", payload: { quota_deferred: true } });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
  });

  it("kill switch: every action is blocked and nothing reaches an adapter", async () => {
    const task = seedTask(state);
    state.killSwitch.set("company-1", true);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    expect(gated).toMatchObject({ kind: "blocked", reason: expect.stringContaining("kill_switch") });
    expect(events).toEqual([]);
  });

  it("budget cap: a spend over the daily ads cap is a card even with an auto rule", async () => {
    const task = seedTask(state);
    state.autoRules.set("company-1", [{ id: "rule-1", kind: "ads.start", active: true }]);
    state.budgets.set("company-1", [{ ...adsBudget, dailyLimitUsd: 5 }]);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart({ amountUsd: 10, payload: { dailyBudgetUsd: 10 } }));
    expect(gated.kind).toBe("card");
    expect(state.actions[0]?.payload.reasons).toContain("budget_cap");
  });

  it("PRO-1 / ADR 0012: an agent-origin signal.pursue is blocked worker_only; the worker's own opens a K2 card with the evidence in its facts", async () => {
    const task = seedTask(state, { role: "research", taskType: "market_report" });
    const spec = { kind: "signal.pursue" as const, companyId: "x", agentRole: "research", requestedTier: "K2" as const, description: 'Look into "A post" (reddit, score 0.85)', payload: { signalId: "sig-1", kind: "opportunity", source: "reddit", title: "A post", url: "https://www.reddit.com/r/x/1/", score: 0.85, taskType: "signal_research" } };
    const agent = await gateAction(fakeDeps(state, events), task.id, spec);
    expect(agent).toMatchObject({ kind: "blocked", reason: "worker_only" });
    expect(state.actions[0]).toMatchObject({ status: "blocked", payload: { worker_only: true } });
    expect(state.cards.size).toBe(0);
    const worker = await gateAction(fakeDeps(state, events), task.id, spec, { origin: "worker" });
    if (worker.kind !== "card") throw new Error(worker.kind);
    expect(state.cards.get(worker.cardId)).toMatchObject({ tier: "K2", actionKind: "signal.pursue", defaultOptionId: "decline", question: 'Look into "A post"? (reddit, score 0.85)' });
    expect(state.cards.get(worker.cardId)?.rationale).toContain("evidence: https://www.reddit.com/r/x/1/");
    expect(events).toEqual([]);
  });

  it("H2: a payload that would spend more than the gated amount is rejected before gating", async () => {
    const task = seedTask(state);
    await expect(gateAction(fakeDeps(state, events), task.id, adsStart({ amountUsd: 10, payload: { dailyBudgetUsd: 1000 } }))).rejects.toThrow(/amountUsd/);
    expect(state.actions).toEqual([]);
  });
});

describe("quota-deferred retry (DEC-3)", () => {
  it("re-gates a deferred action once: the retry marks it and the next scan skips it", async () => {
    const task = seedTask(state);
    state.quotaExhausted = true;
    await gateAction(fakeDeps(state, events), task.id, adsStart());
    expect(await deferredTaskIds(fakeDeps(state, events))).toEqual([{ companyId: "company-1", taskId: task.id }]);
    const specs = await deferredActionsFor(fakeDeps(state, events).db, state.tasks.get(task.id) as never);
    expect(specs.map((s) => s.kind)).toEqual(["ads.start"]);
    expect(state.actions.at(-1)).toMatchObject({ status: "blocked", supersedes: state.actions[0]?.id, payload: { note: "retried" } });
    expect(await deferredActionsFor(fakeDeps(state, events).db, state.tasks.get(task.id) as never)).toEqual([]);
    expect(await deferredTaskIds(fakeDeps(state, events))).toEqual([]);
    // Next day: the retry opens the card against the parked task without an illegal transition.
    state.quotaExhausted = false;
    const gated = await gateAction(fakeDeps(state, events), task.id, specs[0]!);
    expect(gated.kind).toBe("card");
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
  });
});

describe("settleDecision (DEC-2): the card's stored answer is the only input", () => {
  it("H1: an event for an unanswered card settles nothing and executes nothing", async () => {
    const task = seedTask(state);
    const gated = await openCardFor(task.id);
    expect(await settleDecision(fakeDeps(state, events), gated.cardId)).toEqual({ kind: "unanswered", cardId: gated.cardId });
    expect(state.actions.map((a) => a.status)).toEqual(["pending"]);
    expect(events).toEqual([]);
  });

  it("approve hands the pending action back to be performed and recorded in separate steps, then the task finishes with evidence", async () => {
    const task = seedTask(state, { result: { artifactIds: ["art-1"], costUsd: 0.2, summary: "spec" } });
    const gated = await openCardFor(task.id);
    Object.assign(state.cards.get(gated.cardId)!, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    const deps = fakeDeps(state, events);
    const settlement = await settleDecision(deps, gated.cardId);
    expect(settlement).toMatchObject({ kind: "perform", actionIds: [gated.actionId], taskId: task.id, tier: "K2" });
    if (settlement.kind !== "perform") return;
    const outcome = await performPending(deps, settlement.actionIds[0]!);
    const completed = await completeAction(deps, { actionId: settlement.actionIds[0]!, tier: settlement.tier, outcome });
    expect(completed).toMatchObject({ status: "executed", externalRef: expect.stringMatching(/^sandbox:campaign:/) });
    expect(events.map((e) => e.op)).toEqual(["startCampaign"]);
    // The executed start registered the campaign row (ADR 0009).
    expect([...state.campaigns.values()]).toHaveLength(1);
    expect([...state.campaigns.values()][0]).toMatchObject({ actionId: gated.actionId, taskId: task.id, providerCampaignId: completed.externalRef, status: "active", dailyBudgetUsd: 10, totalBudgetUsd: 50, metricKey: "signups" });
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "done" });
    // AGT-2: the campaign id (confirmed by ads.status) is the evidence, stronger than the artifact.
    expect(state.tasks.get(task.id)).toMatchObject({ status: "done", evidence: { kind: "campaign_id", ref: completed.externalRef, verified: true } });
    expect(state.ledger).toHaveLength(1);
  });

  it("decline appends a declined transition, touches no adapter, and the task still finishes on its artifact", async () => {
    const task = seedTask(state, { result: { artifactIds: ["art-1"], costUsd: 0, summary: "spec" } });
    const gated = await openCardFor(task.id);
    Object.assign(state.cards.get(gated.cardId)!, { answeredOptionId: "decline", answeredAt: new Date().toISOString(), answeredBy: "user" });
    const settlement = await settleDecision(fakeDeps(state, events), gated.cardId);
    expect(settlement).toMatchObject({ kind: "declined", taskId: task.id });
    expect(state.actions.at(-1)).toMatchObject({ status: "declined", supersedes: gated.actionId });
    expect(events).toEqual([]);
    expect(await finishTaskIfIdle(fakeDeps(state, events), task.id)).toEqual({ status: "done" });
  });

  it("settling twice is a no-op the second time (replayed events)", async () => {
    const task = seedTask(state);
    const gated = await openCardFor(task.id);
    Object.assign(state.cards.get(gated.cardId)!, { answeredOptionId: "decline", answeredAt: new Date().toISOString(), answeredBy: "user" });
    await settleDecision(fakeDeps(state, events), gated.cardId);
    expect(await settleDecision(fakeDeps(state, events), gated.cardId)).toEqual({ kind: "nothing", cardId: gated.cardId });
    expect(state.actions).toHaveLength(2);
  });

  it("a task waits while any of its cards is still pending, and finishes only when the last one settles", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch", result: { artifactIds: ["art-1"], costUsd: 0, summary: "batch" } });
    for (const r of ["a@example.test", "b@example.test"]) await seedLead(r);
    const mail = (to: string) => ({ kind: "email.send.first_contact" as const, companyId: "x", agentRole: "x", description: `Email ${to}`, payload: { to, subject: "s", text: "t" } });
    const first = await openCardFor(task.id, mail("a@example.test"));
    const second = await openCardFor(task.id, mail("b@example.test"));
    Object.assign(state.cards.get(first.cardId)!, { answeredOptionId: "decline", answeredAt: new Date().toISOString(), answeredBy: "user" });
    await settleDecision(fakeDeps(state, events), first.cardId);
    expect(await finishTaskIfIdle(fakeDeps(state, events), task.id)).toEqual({ status: "waiting_decision" });
    Object.assign(state.cards.get(second.cardId)!, { answeredOptionId: "decline", answeredAt: new Date().toISOString(), answeredBy: "user" });
    await settleDecision(fakeDeps(state, events), second.cardId);
    expect(await finishTaskIfIdle(fakeDeps(state, events), task.id)).toEqual({ status: "done" });
  });

  it("resume finds answered cards whose action is still pending so they can be re-settled", async () => {
    const task = seedTask(state);
    const gated = await openCardFor(task.id);
    expect(await unsettledAnsweredCards(fakeDeps(state, events), "company-1")).toEqual([]);
    Object.assign(state.cards.get(gated.cardId)!, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    expect(await unsettledAnsweredCards(fakeDeps(state, events), "company-1")).toEqual([{ cardId: gated.cardId, optionId: "approve", answeredBy: "user" }]);
  });
});

describe("decision deadlines", () => {
  it("applies the K2 safe default to overdue cards and leaves K3 cards open", async () => {
    const task = seedTask(state);
    const k2 = await openCardFor(task.id);
    const ops = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await seedLead("reg@example.test");
    const k3 = await openCardFor(ops.id, { kind: "email.send.first_contact", companyId: "x", agentRole: "x", description: "Email the regulator", requestedTier: "K3", payload: { to: "reg@example.test", subject: "s", text: "t" } });
    expect(state.cards.get(k3.cardId)).toMatchObject({ tier: "K3", defaultOptionId: null });
    const past = new Date(Date.now() - 1000).toISOString();
    state.cards.get(k2.cardId)!.dueAt = past;
    state.cards.get(k3.cardId)!.dueAt = past;
    const defaulted = await applyOverdueDefaults(fakeDeps(state, events));
    expect(defaulted).toEqual([{ cardId: k2.cardId, companyId: "company-1", optionId: "decline" }]);
    expect(state.cards.get(k2.cardId)).toMatchObject({ answeredOptionId: "decline", answeredBy: "default" });
    expect(state.cards.get(k3.cardId)?.answeredAt).toBeNull();
    expect((await settleDecision(fakeDeps(state, events), k2.cardId)).kind).toBe("declined");
  });
});

describe("finishTaskIfIdle (AGT-2: no evidence, no done)", () => {
  it("fails a task that produced neither an artifact nor an executed action with evidence", async () => {
    const task = seedTask(state);
    expect(await finishTaskIfIdle(fakeDeps(state, events), task.id)).toEqual({ status: "failed" });
    expect(state.tasks.get(task.id)?.status).toBe("failed");
  });

  it("a sandbox no-op or internal reference is never evidence", async () => {
    const task = seedTask(state, { role: "research", taskType: "market_report" });
    await gateAction(fakeDeps(state, events), task.id, { kind: "research", companyId: "x", agentRole: "x", description: "Searched" });
    expect(await finishTaskIfIdle(fakeDeps(state, events), task.id)).toEqual({ status: "failed" });
  });

  it("uses an executed action's reference as evidence for action-only tasks", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const lead = await seedLead("a@example.test", "replied", "sandbox:msg:first");
    await executeThrough(task.id, { kind: "email.send.reply", companyId: "x", agentRole: "x", description: "Reply", payload: { to: "a@example.test", subject: "Re", text: "t", leadId: lead.id } });
    expect(await finishTaskIfIdle(fakeDeps(state, events), task.id)).toEqual({ status: "done" });
    expect(state.tasks.get(task.id)?.evidence).toMatchObject({ kind: "message_id", ref: expect.stringMatching(/^sandbox:msg:/), verified: true });
  });

  it("is a no-op for done, failed and queued tasks", async () => {
    const done = seedTask(state, { status: "done" });
    const queued = seedTask(state, { status: "queued", attempts: 0 });
    expect(await finishTaskIfIdle(fakeDeps(state, events), done.id)).toEqual({ status: "already" });
    expect(await finishTaskIfIdle(fakeDeps(state, events), queued.id)).toEqual({ status: "already" });
  });
});

describe("notifyDecision (DEC-2 delivery)", () => {
  it("pushes to every subscription, emails the owner and logs each attempt as sandbox", async () => {
    state.companies.set("company-1", { id: "company-1", slug: "lumen", name: "Lumen", ownerId: "user-1" });
    state.profiles.set("user-1", { id: "user-1", email: "ceo@example.test", timezone: "UTC", dailyDecisionQuota: 3, plan: "free" });
    state.pushSubscriptions = [
      { endpoint: "https://push.example.test/a", p256dh: "p", auth: "a" },
      { endpoint: "https://push.example.test/b", p256dh: "p", auth: "a" },
    ];
    const task = seedTask(state);
    const gated = await openCardFor(task.id);
    const result = await notifyDecision(fakeDeps(state, events), "company-1", gated.cardId, "http://localhost:3100/");
    expect(result).toEqual({ push: 2, email: true });
    expect(events.map((e) => e.provider)).toEqual(["push", "push", "mail"]);
    expect(state.notifications).toHaveLength(3);
    expect(state.notifications[0]).toMatchObject({ channel: "push", status: "sandbox", cardId: gated.cardId });
    expect(JSON.stringify(events)).not.toContain('"auth"');
    expect(cardUrl("http://localhost:3100/", "lumen", "card-1")).toBe("http://localhost:3100/c/lumen/decisions/card-1");
  });
});
