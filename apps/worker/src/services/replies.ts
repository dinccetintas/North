import { ActionSpecSchema, batchPayload, windowDelta, type ActionSpec } from "@north/core";
import { latestChannelSample, latestMetric, listActionsByKind, markLeads, recordAttributionWindow, recordMetric, type ActionRecord, type DbClient } from "@north/db";
import type { WorkerDeps } from "../deps";
import { providerAuthFor } from "./provider-auth";

/** The sends of one outreach batch: executed first-contact heads grouped by their `batchId`, with the lead each one contacted. */
export interface OutreachBatch {
  readonly batchId: string;
  readonly taskId: string | null;
  readonly messageIds: readonly string[];
  readonly leadIdByMessage: Readonly<Record<string, string>>;
}

export interface RepliesResult {
  readonly batches: number;
  readonly entries: number;
  readonly totalReplies: number;
}

const SINCE_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored specs of the rows these heads superseded (the executed row carries no payload of its own). */
async function specsByHead(db: DbClient, heads: readonly ActionRecord[]): Promise<ReadonlyMap<string, ActionSpec>> {
  const out = new Map<string, ActionSpec>();
  const pending = new Map<string, string>();
  for (const head of heads) {
    const own = ActionSpecSchema.safeParse((head.payload as { spec?: unknown }).spec);
    if (own.success) out.set(head.id, own.data);
    else if (head.supersedes) pending.set(head.supersedes, head.id);
  }
  if (pending.size === 0) return out;
  const { data, error } = await db.from("actions").select("id, payload").in("id", [...pending.keys()]);
  if (error) throw new Error(`could not load batch specs: ${error.message}`);
  for (const row of data ?? []) {
    const parsed = ActionSpecSchema.safeParse((row.payload as { spec?: unknown } | null)?.spec);
    const headId = pending.get(row.id);
    if (parsed.success && headId) out.set(headId, parsed.data);
  }
  return out;
}

/** Executed first-contact sends of the last 30 days, grouped by batch (SLS-K2). */
export async function outreachBatches(db: DbClient, companyId: string): Promise<readonly OutreachBatch[]> {
  const heads = (await listActionsByKind(db, companyId, "email.send.first_contact", SINCE_DAYS)).filter((a) => a.status === "executed" && a.externalRef !== null);
  const specs = await specsByHead(db, heads);
  const groups = new Map<string, { taskId: string | null; messageIds: string[]; leadIdByMessage: Record<string, string> }>();
  for (const head of heads) {
    const spec = specs.get(head.id);
    const batch = batchPayload(spec?.payload);
    const messageId = head.externalRef;
    if (!batch || !messageId) continue;
    const group = groups.get(batch.batchId) ?? { taskId: head.taskId, messageIds: [], leadIdByMessage: {} };
    const leadId = spec?.payload?.leadId;
    groups.set(batch.batchId, {
      taskId: group.taskId ?? head.taskId,
      messageIds: [...group.messageIds, messageId],
      leadIdByMessage: typeof leadId === "string" && UUID.test(leadId) ? { ...group.leadIdByMessage, [messageId]: leadId } : group.leadIdByMessage,
    });
  }
  return Object.freeze([...groups.entries()].map(([batchId, g]) => Object.freeze({ batchId, taskId: g.taskId, messageIds: Object.freeze([...g.messageIds]), leadIdByMessage: Object.freeze({ ...g.leadIdByMessage }) })));
}

/** One batch's replies as a cumulative channel sample and a ledger window; replied leads are marked. A count that did not move (or a first window with no reply yet) writes nothing. */
async function collectBatch(deps: WorkerDeps, companyId: string, batch: OutreachBatch, windowEnd: string, sandbox: boolean): Promise<{ readonly replies: number; readonly newEntry: boolean }> {
  const auth = await providerAuthFor(deps, companyId, "email.send.first_contact");
  const counts = await deps.integrations.outreach(auth).replies({ companyId, messageIds: [...batch.messageIds] });
  const replies = counts.reduce((sum, c) => sum + c.replies, 0);
  const key = `cold_email:${batch.batchId}`;
  const previous = await latestChannelSample(deps.db, companyId, "email_replies", key);
  if (previous ? previous.value === replies : replies === 0) return { replies, newEntry: false };
  const delta = windowDelta(previous ? { value: previous.value, spendUsd: 0 } : null, { value: replies, spendUsd: 0 });
  const result = await recordAttributionWindow(deps.db, {
    companyId,
    taskId: batch.taskId,
    metricKey: "email_replies",
    provenance: { channel: "cold_email", batchId: batch.batchId, messageIds: [...batch.messageIds], windowEnd, sandbox, raw: { replies, sent: batch.messageIds.length, repliesInWindow: delta.after - delta.before } },
    samples: [{ metricKey: "emails_sent", value: batch.messageIds.length }],
    before: delta.before,
    after: delta.after,
    costUsd: 0,
    note: `${batch.messageIds.length} first-contact emails, ${replies} replies so far`,
  });
  const repliedLeads = counts.filter((c) => c.replies > 0).flatMap((c) => (batch.leadIdByMessage[c.messageId] ? [batch.leadIdByMessage[c.messageId] as string] : []));
  if (repliedLeads.length > 0) await markLeads(deps.db, repliedLeads, "replied");
  return { replies, newEntry: !result.duplicate };
}

/**
 * OUT-2 for sales: every batch's replies from the user's own mailbox become
 * a `cold_email` channel sample and ledger window (cost 0), replied leads are
 * marked, and the company's `email_replies` series gets the total. A batch
 * whose count did not move writes nothing.
 */
export async function collectReplies(deps: WorkerDeps, companyId: string, now: Date = new Date()): Promise<RepliesResult> {
  const batches = await outreachBatches(deps.db, companyId);
  if (batches.length === 0) return { batches: 0, entries: 0, totalReplies: 0 };
  const windowEnd = now.toISOString();
  const sandbox = deps.integrations.mode === "sandbox";
  let entries = 0;
  let totalReplies = 0;
  for (const batch of batches) {
    const collected = await collectBatch(deps, companyId, batch, windowEnd, sandbox);
    totalReplies += collected.replies;
    if (collected.newEntry) entries += 1;
  }
  const current = await latestMetric(deps.db, companyId, "email_replies");
  if (entries > 0 || current === null) await recordMetric(deps.db, { companyId, metricKey: "email_replies", value: totalReplies, source: "outreach" });
  return { batches: batches.length, entries, totalReplies };
}
