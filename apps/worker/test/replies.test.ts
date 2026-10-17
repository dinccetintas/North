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

  it("CMP-1: a bounced lead is marked bounced and suppressed (bounce), an opted-out lead opted_out and suppressed (opt_out); neither is a reply in the window; a repeat writes nothing more", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch", status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const { messageIds } = await sentBatch(deps, task.id);
    const [batch] = await outreachBatches(deps.db, "company-1");
    const leadOf = (messageId: string) => state.leads.get(batch!.leadIdByMessage[messageId]!)!;
    const outreach = (deps.integrations as SandboxIntegrations).sandbox.outreach;
    await outreach.simulateReply(messageIds[0]!, undefined, "bounce");
    await outreach.simulateReply(messageIds[1]!, undefined, "opt_out");
    await outreach.simulateReply(messageIds[2]!);

    expect(await collectReplies(deps, "company-1")).toEqual({ batches: 1, entries: 1, totalReplies: 1 });
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ before: 0, after: 1, provenance: { raw: { replies: 1, bounced: 1, optedOut: 1 } } });
    expect(leadOf(messageIds[0]!).status).toBe("bounced");
    expect(leadOf(messageIds[1]!).status).toBe("opted_out");
    expect(leadOf(messageIds[2]!).status).toBe("replied");
    // One row per address, naming the executed send it came from.
    const headOf = (messageId: string) => state.actions.find((a) => a.status === "executed" && a.externalRef === messageId)?.id;
    expect(state.suppressions).toHaveLength(2);
    expect(state.suppressions).toEqual(
      expect.arrayContaining([
        { companyId: "company-1", email: leadOf(messageIds[0]!).email, reason: "bounce", sourceActionId: headOf(messageIds[0]!) },
        { companyId: "company-1", email: leadOf(messageIds[1]!).email, reason: "opt_out", sourceActionId: headOf(messageIds[1]!) },
      ]),
    );

    // A second bounce notice and a later collection: no throw, no second row, no new window.
    await outreach.simulateReply(messageIds[0]!, undefined, "bounce");
    expect(await collectReplies(deps, "company-1")).toEqual({ batches: 1, entries: 0, totalReplies: 1 });
    expect(state.suppressions).toHaveLength(2);
    expect(state.ledger).toHaveLength(1);
  });

  it("CMP-1: a lead that replied and later asks to stop is opted out, and the batch's count never moves backwards into a negative window", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch", status: "done" });
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const { messageIds } = await sentBatch(deps, task.id);
    const outreach = (deps.integrations as SandboxIntegrations).sandbox.outreach;
    await outreach.simulateReply(messageIds[0]!);
    await outreach.simulateReply(messageIds[1]!);
    expect(await collectReplies(deps, "company-1")).toMatchObject({ entries: 1, totalReplies: 2 });
    await outreach.simulateReply(messageIds[0]!, undefined, "opt_out");
    expect(await collectReplies(deps, "company-1")).toMatchObject({ entries: 0, totalReplies: 1 });
    expect(state.ledger).toHaveLength(1);
    const [batch] = await outreachBatches(deps.db, "company-1");
    expect(state.leads.get(batch!.leadIdByMessage[messageIds[0]!]!)?.status).toBe("opted_out");
    expect(state.suppressions.map((r) => r.reason)).toEqual(["opt_out"]);
  });

  it("a company without sends collects nothing", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    expect(await collectReplies(deps, "company-1")).toEqual({ batches: 0, entries: 0, totalReplies: 0 });
    expect(state.ledger).toHaveLength(0);
  });
});
