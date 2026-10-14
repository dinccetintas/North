import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { adsStart, emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

const state: FakeState = emptyState();
vi.mock("@north/db", () => fakeDbModule(state));

const { deferredActionsFor, finishTask, gateAction, performAction, settleCard } = await import("../src/services/actions");
const { notifyDecision, cardUrl } = await import("../src/services/notify");
const { deferredTaskIds } = await import("../src/services/kill-switch");

const adsBudget = { category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 };

let events: SandboxEvent[];

beforeEach(() => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [adsBudget]);
  events = [];
});

describe("performAction", () => {
  it("routes ads.start to the ads adapter and returns the sandbox campaign ref", async () => {
    const ref = await performAction(fakeDeps(state, events), adsStart());
    expect(ref).toMatch(/^sandbox:campaign:/);
    expect(events[0]).toMatchObject({ provider: "ads", op: "startCampaign", companyId: "company-1", payload: { dailyBudgetUsd: 10 } });
  });

  it("routes first-contact email to the mail adapter", async () => {
    const ref = await performAction(fakeDeps(state, events), { kind: "email.send.first_contact", companyId: "company-1", agentRole: "sales", description: "Hello", payload: { to: "mara@example.test", subject: "Hi", text: "Body" } });
    expect(ref).toMatch(/^sandbox:msg:/);
    expect(events[0]).toMatchObject({ provider: "mail", payload: { to: "mara@example.test", kind: "first_contact" } });
  });

  it("marks internal kinds as internal and unknown external kinds as a sandbox no-op", async () => {
    const deps = fakeDeps(state, events);
    expect(await performAction(deps, { kind: "research", companyId: "company-1", agentRole: "research", description: "Search" })).toBe("internal");
    expect(await performAction(deps, { kind: "deploy.preview", companyId: "company-1", agentRole: "engineering", description: "Deploy" })).toBe("sandbox:noop:deploy.preview");
    expect(events).toEqual([]);
  });
});

describe("gateAction (DEC-1 through AuthorityEngine.gate)", () => {
  it("K0 research runs immediately and is recorded as executed", async () => {
    const task = seedTask(state, { role: "research", taskType: "market_report" });
    const gated = await gateAction(fakeDeps(state, events), task.id, { kind: "research", companyId: "x", agentRole: "x", description: "Search the market" });
    expect(gated).toMatchObject({ kind: "executed", externalRef: "internal" });
    expect(state.actions[0]).toMatchObject({ kind: "research", tier: "K0", status: "executed", taskId: task.id, companyId: "company-1" });
  });

  it("K2 ads.start opens a card, records a pending action tied to it and parks the task", async () => {
    const task = seedTask(state);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    expect(gated.kind).toBe("card");
    if (gated.kind !== "card") return;
    const card = state.cards.get(gated.cardId);
    expect(card).toMatchObject({ tier: "K2", actionKind: "ads.start", taskId: task.id, defaultOptionId: "decline" });
    expect(state.actions[0]).toMatchObject({ id: gated.actionId, status: "pending", tier: "K2", decisionCardId: gated.cardId, payload: { gate: "card", spec: expect.objectContaining({ kind: "ads.start" }) } });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
    expect(events).toEqual([]);
  });

  it("never lets an agent lower its tier: a requested K0 on ads.start still opens a card", async () => {
    const task = seedTask(state);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart({ requestedTier: "K0" }));
    expect(gated.kind).toBe("card");
  });

  it("a matching auto rule runs the K2 action without a card and records the rule", async () => {
    const task = seedTask(state);
    state.autoRules.set("company-1", [{ id: "rule-1", kind: "ads.start", maxAmountUsd: 100, category: "ads", active: true }]);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart({ amountUsd: 15 }));
    expect(gated).toMatchObject({ kind: "executed" });
    expect(state.actions[0]).toMatchObject({ status: "executed", autoRuleId: "rule-1", externalRef: expect.stringMatching(/^sandbox:campaign:/) });
    expect(state.cards.size).toBe(0);
  });

  it("DEC-3: when the quota is spent the action is deferred, not dropped", async () => {
    const task = seedTask(state);
    state.quotaExhausted = true;
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    expect(gated.kind).toBe("deferred");
    expect(state.actions[0]).toMatchObject({ status: "blocked", payload: { quota_deferred: true, spec: expect.objectContaining({ kind: "ads.start" }) } });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
  });

  it("kill switch: every action is blocked and nothing reaches an adapter", async () => {
    const task = seedTask(state);
    state.killSwitch.set("company-1", true);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    expect(gated.kind).toBe("blocked");
    expect(state.actions[0]).toMatchObject({ status: "blocked", payload: { reasons: expect.arrayContaining(["kill_switch"]) } });
    expect(events).toEqual([]);
  });

  it("budget cap: a spend over the daily ads cap is a card even with an auto rule", async () => {
    const task = seedTask(state);
    state.autoRules.set("company-1", [{ id: "rule-1", kind: "ads.start", active: true }]);
    state.budgets.set("company-1", [{ ...adsBudget, dailyLimitUsd: 5 }]);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart({ amountUsd: 10 }));
    expect(gated.kind).toBe("card");
    expect(state.actions[0]?.payload.reasons).toContain("budget_cap");
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
  });
});

describe("settleCard (DEC-2)", () => {
  async function pendingCard() {
    const task = seedTask(state);
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    if (gated.kind !== "card") throw new Error("expected a card");
    return { task, gated };
  }

  it("approve executes through the adapter and appends an executed transition", async () => {
    const { task, gated } = await pendingCard();
    const result = await settleCard(fakeDeps(state, events), { taskId: task.id, actionId: gated.actionId, cardId: gated.cardId, optionId: "approve" });
    expect(result).toMatchObject({ settled: true, outcome: "executed", externalRef: expect.stringMatching(/^sandbox:campaign:/) });
    expect(state.actions.at(-1)).toMatchObject({ status: "executed", supersedes: gated.actionId, payload: { note: "option approve" } });
    expect(events.map((e) => e.op)).toEqual(["startCampaign"]);
  });

  it("decline appends a declined transition and touches no adapter", async () => {
    const { task, gated } = await pendingCard();
    const result = await settleCard(fakeDeps(state, events), { taskId: task.id, actionId: gated.actionId, cardId: gated.cardId, optionId: "decline" });
    expect(result).toEqual({ settled: true, outcome: "declined", externalRef: null });
    expect(state.actions.at(-1)).toMatchObject({ status: "declined", supersedes: gated.actionId });
    expect(events).toEqual([]);
  });

  it("deadline without an answer applies the K2 safe default (decline) and records it as a default answer", async () => {
    const { task, gated } = await pendingCard();
    const result = await settleCard(fakeDeps(state, events), { taskId: task.id, actionId: gated.actionId, cardId: gated.cardId, optionId: null });
    expect(result).toMatchObject({ settled: true, outcome: "declined" });
    expect(state.cards.get(gated.cardId)).toMatchObject({ answeredOptionId: "decline", answeredBy: "default" });
  });

  it("uses the answer already stored on the card when the event carried none", async () => {
    const { task, gated } = await pendingCard();
    Object.assign(state.cards.get(gated.cardId)!, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    const result = await settleCard(fakeDeps(state, events), { taskId: task.id, actionId: gated.actionId, cardId: gated.cardId, optionId: null });
    expect(result).toMatchObject({ settled: true, outcome: "executed" });
  });

  it("K3 has no default: an unanswered card stays unsettled", async () => {
    const task = seedTask(state, { role: "ops_finance" });
    const gated = await gateAction(fakeDeps(state, events), task.id, { kind: "contract.sign", companyId: "x", agentRole: "x", description: "Sign the vendor contract" });
    if (gated.kind !== "card") throw new Error("expected a K3 card");
    expect(state.cards.get(gated.cardId)?.tier).toBe("K3");
    const result = await settleCard(fakeDeps(state, events), { taskId: task.id, actionId: gated.actionId, cardId: gated.cardId, optionId: null });
    expect(result).toEqual({ settled: false, reason: expect.stringMatching(/K3/) });
    expect(state.cards.get(gated.cardId)?.answeredAt).toBeNull();
  });
});

describe("finishTask (AGT-2: no evidence, no done)", () => {
  it("stays waiting while decisions are unsettled", async () => {
    const task = seedTask(state, { status: "waiting_decision" });
    const result = await finishTask(fakeDeps(state, events), { taskId: task.id, artifactIds: ["art-1"], costUsd: 0, summary: "s", executedRefs: [], unsettled: 1 });
    expect(result).toEqual({ status: "waiting_decision" });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
  });

  it("fails a task that produced neither an artifact nor an executed action", async () => {
    const task = seedTask(state);
    const result = await finishTask(fakeDeps(state, events), { taskId: task.id, artifactIds: [], costUsd: 0, summary: "", executedRefs: [], unsettled: 0 });
    expect(result).toEqual({ status: "failed" });
    expect(state.tasks.get(task.id)?.status).toBe("failed");
  });

  it("resumes a waiting task, marks it done with artifact evidence and writes the ledger", async () => {
    const task = seedTask(state, { status: "waiting_decision" });
    const result = await finishTask(fakeDeps(state, events), { taskId: task.id, artifactIds: ["art-1"], costUsd: 0.5, summary: "done", executedRefs: ["sandbox:campaign:1"], unsettled: 0 });
    expect(result).toEqual({ status: "done" });
    expect(state.tasks.get(task.id)).toMatchObject({ status: "done", evidence: { kind: "artifact_id", ref: "art-1", verified: true, sandbox: true } });
    expect(state.ledger).toHaveLength(1);
    expect(state.metrics.at(-1)).toMatchObject({ metricKey: "artifacts", value: 1 });
  });

  it("uses the executed action's ref as evidence for action-only tasks", async () => {
    const task = seedTask(state);
    await finishTask(fakeDeps(state, events), { taskId: task.id, artifactIds: [], costUsd: 0, summary: "sent", executedRefs: ["sandbox:msg:1"], unsettled: 0 });
    expect(state.tasks.get(task.id)?.evidence).toMatchObject({ kind: "message_id", ref: "sandbox:msg:1" });
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
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    if (gated.kind !== "card") throw new Error("expected a card");

    const result = await notifyDecision(fakeDeps(state, events), "company-1", gated.cardId, "http://localhost:3100/");
    expect(result).toEqual({ push: 2, email: true });
    expect(events.map((e) => e.provider)).toEqual(["push", "push", "mail"]);
    expect(state.notifications).toHaveLength(3);
    expect(state.notifications[0]).toMatchObject({ channel: "push", status: "sandbox", cardId: gated.cardId });
    expect(state.notifications[2]).toMatchObject({ channel: "email", status: "sandbox" });
    expect(JSON.stringify(events[2]?.payload)).not.toContain("auth");
    expect(cardUrl("http://localhost:3100/", "lumen", "card-1")).toBe("http://localhost:3100/c/lumen/decisions/card-1");
  });
});
