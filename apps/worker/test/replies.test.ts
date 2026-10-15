import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent, SandboxIntegrations } from "@north/integrations";
import { emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

/**
 * D4-4 replies (OUT-2 for sales): the sends of a batch are read back from the
 * user's mailbox; replies become a `cold_email` ledger window (0 → 2, cost 0)
 * and a channel sample, replied leads are marked, the company's
 * `email_replies` series gets the total, and a collection with no new reply
 * writes nothing.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { collectReplies, outreachBatches } = await import("../src/services/replies");
const { completeAction, gateAction, performPending } = await import("../src/services/actions");
const { settleDecision } = await import("../src/services/settle");

let events: SandboxEvent[];
let root: string;

beforeEach(async () => {
  Object.assign(state, emptyState());
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-replies-"));
});

/** Five first-contact sends of one batch, approved and executed: what `collect-company-metrics` finds in the action log. */
async function sentBatch(deps: ReturnType<typeof fakeDeps>, taskId: string) {
  await dbModule.importLeads(null, "company-1", ["a", "b", "c", "d", "e"].map((n) => ({ name: n, email: `${n}@example.test` })), "upload");
  const leads = await dbModule.nextUnsentLeads(null, "company-1", 5);
  const recipients = leads.map((l) => l.email);
  let cardId = "";
  for (const lead of leads) {
    const gated = await gateAction(deps, taskId, { kind: "email.send.first_contact", companyId: "x", agentRole: "x", description: `Email ${lead.email}`, payload: { batchId: `batch-${taskId}`, recipients, to: lead.email, subject: "s", text: "t", leadId: lead.id } });
    if (gated.kind !== "card") throw new Error(gated.kind);
    cardId = gated.cardId;
  }
  Object.assign(state.cards.get(cardId)!, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
  const settlement = await settleDecision(deps, cardId);
  if (settlement.kind !== "perform") throw new Error(settlement.kind);
  for (const actionId of settlement.actionIds) await completeAction(deps, { actionId, tier: settlement.tier, outcome: await performPending(deps, actionId) });
  return { leads, messageIds: state.actions.filter((a) => a.status === "executed").map((a) => a.externalRef as string) };
}

describe("collectReplies (SLS-K2, OUT-2)", () => {
  it("two replies → one cold_email entry 0 → 2 at no cost, two leads replied, company email_replies = 2; collecting again writes nothing", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch", status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const { leads, messageIds } = await sentBatch(deps, task.id);
    expect(messageIds).toHaveLength(5);

    const batches = await outreachBatches(deps.db, "company-1");
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ batchId: `batch-${task.id}`, taskId: task.id });
    expect([...batches[0]!.messageIds].sort()).toEqual([...messageIds].sort());
    expect(Object.keys(batches[0]!.leadIdByMessage)).toHaveLength(5);

    // No replies yet: a 0 → 0 window would say nothing and is not written; the company series still gets its first sample.
    expect(await collectReplies(deps, "company-1")).toEqual({ batches: 1, entries: 0, totalReplies: 0 });
    expect(state.ledger).toHaveLength(0);
    expect(state.metrics.filter((m) => m.metricKey === "email_replies")).toEqual([expect.objectContaining({ companyId: "company-1", metricKey: "email_replies", value: 0, source: "outreach" })]);

    const outreach = (deps.integrations as SandboxIntegrations).sandbox.outreach;
    await outreach.simulateReply(messageIds[0]!);
    await outreach.simulateReply(messageIds[1]!);
    expect(await collectReplies(deps, "company-1")).toEqual({ batches: 1, entries: 1, totalReplies: 2 });
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ channel: "cold_email", metricKey: "email_replies", before: 0, after: 2, costUsd: 0, taskId: task.id, campaignId: null, provenance: { channel: "cold_email", batchId: `batch-${task.id}`, sandbox: true, raw: { replies: 2, sent: 5 } } });
    expect(state.channelSamples.filter((s) => s.provenanceKey === `cold_email:batch-${task.id}`).map((s) => [s.metricKey, s.value])).toEqual(expect.arrayContaining([["emails_sent", 5], ["email_replies", 2]]));
    const replied = leads.filter((l) => state.leads.get(l.id)?.status === "replied");
    expect(replied).toHaveLength(2);
    expect(leads.filter((l) => state.leads.get(l.id)?.status === "contacted")).toHaveLength(3);
    expect(state.metrics.filter((m) => m.metricKey === "email_replies").at(-1)).toMatchObject({ value: 2, source: "outreach" });

    // Nothing new: no duplicate entry, no new company sample.
    const samplesBefore = state.metrics.length;
    expect(await collectReplies(deps, "company-1")).toEqual({ batches: 1, entries: 0, totalReplies: 2 });
    expect(state.ledger).toHaveLength(1);
    expect(state.metrics.length).toBe(samplesBefore);
  });

  it("a company without sends collects nothing", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    expect(await collectReplies(deps, "company-1")).toEqual({ batches: 0, entries: 0, totalReplies: 0 });
    expect(state.ledger).toHaveLength(0);
  });
});
