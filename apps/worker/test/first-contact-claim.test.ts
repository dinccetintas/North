import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSpec } from "@north/core";
import type { SandboxEvent } from "@north/integrations";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * SLS-K2: a person receives at most one first contact, whatever approved it.
 * Right before the provider call the worker claims the lead with one
 * conditional write only one first-contact action can win (0018); the loser
 * sends nothing and is recorded failed. A failed send releases its claim, so
 * the lead is `new` again exactly as before the claim existed. An auto rule
 * runs a first contact only after the gate checks a card would get: its
 * recipient is a new lead of the company that no open batch holds (0017).
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { completeAction, gateAction, performPending } = await import("../src/services/actions");
const { settleDecision } = await import("../src/services/settle");

let events: SandboxEvent[];
let root: string;
const deps = () => fakeDeps(state, events, 200, "sandbox", root);
const sends = () => events.filter((e) => e.op === "send");
const leadOf = (email: string) => [...state.leads.values()].find((l) => l.email === email)!;
const headOf = (id: string) => {
  let row = state.actions.find((a) => a.id === id)!;
  for (let next = state.actions.find((a) => a.supersedes === row.id); next; next = state.actions.find((a) => a.supersedes === row.id)) row = next;
  return row;
};

const firstContact = (to: string, extra: Record<string, unknown> = {}): ActionSpec => ({
  kind: "email.send.first_contact",
  companyId: "company-1",
  agentRole: "sales",
  description: `Email ${to}`,
  payload: { to, subject: "Hello", text: "t", leadId: leadOf(to).id, ...extra },
});

/** A pending first contact as the gate records it under an auto rule (no card), bypassing the gate's checks. */
async function pendingRow(taskId: string, spec: ActionSpec): Promise<string> {
  return dbModule.recordAction(null, { companyId: "company-1", taskId, agentRole: "sales", kind: spec.kind, tier: "K2", description: spec.description, payload: { ...spec.payload, spec }, status: "pending", autoRuleId: "rule-1", sandbox: true });
}

async function importLeads(addresses: readonly string[]) {
  await dbModule.importLeads(null, "company-1", addresses.map((email) => ({ name: email, email })), "upload");
}

beforeEach(async () => {
  Object.assign(state, emptyState());
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-claim-"));
  seedCompany(state);
});

describe("SLS-K2: the perform-time claim (0018)", () => {
  it("two concurrent performs of first contacts to the same new lead send exactly one email; the loser is failed and leaves the winner's claim alone", async () => {
    await importLeads(["mara@example.test"]);
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const [a, b] = [await pendingRow(task.id, firstContact("mara@example.test")), await pendingRow(task.id, firstContact("mara@example.test", { batchId: "batch-other", recipients: ["mara@example.test"] }))];
    const outcomes = await Promise.all([performPending(deps(), a), performPending(deps(), b)]);
    expect(sends()).toHaveLength(1);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.find((o) => !o.ok)).toMatchObject({ ok: false, error: expect.stringMatching(/is no longer new/) });
    const [winner, loser] = outcomes[0]!.ok ? [a, b] : [b, a];
    await completeAction(deps(), { actionId: loser, tier: "K2", outcome: outcomes[winner === a ? 1 : 0]! });
    await completeAction(deps(), { actionId: winner, tier: "K2", outcome: outcomes[winner === a ? 0 : 1]! });
    expect(headOf(loser)).toMatchObject({ status: "failed" });
    expect(headOf(winner)).toMatchObject({ status: "executed" });
    expect(leadOf("mara@example.test")).toMatchObject({ status: "contacted", contactActionId: winner, messageId: expect.stringMatching(/^sandbox:msg:/) });
  });

  it("a failed provider send releases the lead: new again, no claim, the failed row says so, and the next batch's input offers it", async () => {
    await importLeads(["mara@example.test"]);
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch", result: { artifactIds: ["art-1"], costUsd: 0, summary: "batch" } });
    const gated = await gateAction(deps(), task.id, firstContact("mara@example.test", { subject: "", batchId: `batch-${task.id}`, recipients: ["mara@example.test"] }));
    if (gated.kind !== "card") throw new Error(gated.kind);
    Object.assign(state.cards.get(gated.cardId)!, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    const settlement = await settleDecision(deps(), gated.cardId);
    if (settlement.kind !== "perform") throw new Error(settlement.kind);
    const outcome = await performPending(deps(), settlement.actionIds[0]!);
    expect(outcome.ok).toBe(false);
    expect(await completeAction(deps(), { actionId: settlement.actionIds[0]!, tier: "K2", outcome })).toEqual({ status: "failed", externalRef: null });
    expect(sends()).toEqual([]);
    expect(leadOf("mara@example.test")).toMatchObject({ status: "new", contactActionId: null, messageId: null });
    expect(headOf(gated.actionId).payload.note).toMatch(/lead .* released to new/);
    expect((await dbModule.leadsFreeForOutreach(null, "company-1", 5)).map((l) => l.email)).toEqual(["mara@example.test"]);
  });
});

describe("SLS-K2: an auto-approved first contact passes the card's gate checks", () => {
  beforeEach(() => {
    state.autoRules.set("company-1", [{ id: "rule-1", kind: "email.send.first_contact", active: true }]);
  });

  it("a recipient held by an open batch card is refused before anything is recorded pending or sent", async () => {
    state.autoRules.delete("company-1");
    await importLeads(["a@example.test", "b@example.test"]);
    const batch = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    expect((await gateAction(deps(), batch.id, firstContact("a@example.test", { batchId: `batch-${batch.id}`, recipients: ["a@example.test", "b@example.test"] }))).kind).toBe("card");
    state.autoRules.set("company-1", [{ id: "rule-1", kind: "email.send.first_contact", active: true }]);
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    expect(await gateAction(deps(), task.id, firstContact("b@example.test"))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(state.actions.at(-1)).toMatchObject({ taskId: task.id, status: "blocked", payload: { blocked_reason: "batch_mismatch: b@example.test is already in an open batch" } });
    expect(state.actions.filter((a) => a.taskId === task.id && a.status === "pending")).toEqual([]);
    expect(sends()).toEqual([]);
  });

  it("a recipient that is not a new lead of the company is refused at the gate", async () => {
    await importLeads(["a@example.test"]);
    Object.assign(leadOf("a@example.test"), { status: "contacted" });
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    expect(await gateAction(deps(), task.id, firstContact("a@example.test"))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(state.actions.at(-1)?.payload.blocked_reason).toBe("batch_mismatch: a@example.test is not a new lead of this company");
  });

  it("a batch of three under the rule sends each email once: every send checks its own recipient, not the ones already contacted", async () => {
    await importLeads(["a@example.test", "b@example.test", "c@example.test"]);
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const recipients = ["a@example.test", "b@example.test", "c@example.test"];
    for (const to of recipients) {
      const gated = await gateAction(deps(), task.id, firstContact(to, { batchId: `batch-${task.id}`, recipients }));
      if (gated.kind !== "execute") throw new Error(`${to}: ${gated.kind} ${"reason" in gated ? gated.reason : ""}`);
      const outcome = await performPending(deps(), gated.actionId);
      expect(await completeAction(deps(), { actionId: gated.actionId, tier: gated.tier, outcome })).toMatchObject({ status: "executed" });
    }
    expect(sends().map((e) => e.payload.to)).toEqual(recipients);
    expect(recipients.map((r) => leadOf(r).status)).toEqual(["contacted", "contacted", "contacted"]);
    expect(state.cards.size).toBe(0);
  });
});
