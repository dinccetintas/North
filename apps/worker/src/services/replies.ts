import { batchPayload, windowDelta } from "@north/core";
import { getLead, latestChannelSample, latestMetric, listActionsByKind, listLeads, markLeads, recordAttributionWindow, recordMetric, type DbClient } from "@north/db";
import type { ReplyCount } from "@north/integrations";
import type { WorkerDeps } from "../deps";
import { specsByHead } from "./action-specs";
import { providerAuthFor } from "./provider-auth";
import { suppressOnce } from "./suppress";

/** The sends of one outreach batch: executed first-contact heads grouped by their `batchId`, with the lead each one contacted and the action that sent it. */
export interface OutreachBatch {
  readonly batchId: string;
  readonly taskId: string | null;
  readonly messageIds: readonly string[];
  readonly leadIdByMessage: Readonly<Record<string, string>>;
  /** CMP-1: the executed head of each send, named as the source of a bounce or opt-out suppression. */
  readonly actionIdByMessage: Readonly<Record<string, string>>;
}

export interface RepliesResult {
  readonly batches: number;
  readonly entries: number;
  readonly totalReplies: number;
}

const SINCE_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Executed first-contact sends of the last 30 days, grouped by batch (SLS-K2). */
export async function outreachBatches(db: DbClient, companyId: string): Promise<readonly OutreachBatch[]> {
  const heads = (await listActionsByKind(db, companyId, "email.send.first_contact", SINCE_DAYS)).filter((a) => a.status === "executed" && a.externalRef !== null);
  const specs = await specsByHead(db, heads);
  const groups = new Map<string, { taskId: string | null; messageIds: string[]; leadIdByMessage: Record<string, string>; actionIdByMessage: Record<string, string> }>();
  for (const head of heads) {
    const spec = specs.get(head.id);
    const batch = batchPayload(spec?.payload);
    const messageId = head.externalRef;
    if (!batch || !messageId) continue;
    const group = groups.get(batch.batchId) ?? { taskId: head.taskId, messageIds: [], leadIdByMessage: {}, actionIdByMessage: {} };
    const leadId = spec?.payload?.leadId;
    groups.set(batch.batchId, {
      taskId: group.taskId ?? head.taskId,
      messageIds: [...group.messageIds, messageId],
      leadIdByMessage: typeof leadId === "string" && UUID.test(leadId) ? { ...group.leadIdByMessage, [messageId]: leadId } : group.leadIdByMessage,
      actionIdByMessage: { ...group.actionIdByMessage, [messageId]: head.id },
    });
  }
  return Object.freeze(
    [...groups.entries()].map(([batchId, g]) => Object.freeze({ batchId, taskId: g.taskId, messageIds: Object.freeze([...g.messageIds]), leadIdByMessage: Object.freeze({ ...g.leadIdByMessage }), actionIdByMessage: Object.freeze({ ...g.actionIdByMessage }) })),
  );
}

/** CMP-1: neither a bounce nor a reply asking to stop counts as a reply. */
const isPlainReply = (count: ReplyCount): boolean => !count.bounced && !count.optedOut;

/** Lead statuses whose outcome is final: their sends are not read again (no thread, no snippet). */
const SETTLED_STATUSES = ["bounced", "opted_out"] as const;
const LEAD_PAGE = 1000;

/** The ids of the company's leads already bounced or opted out, paged past PostgREST's 1000 rows. */
async function settledLeads(db: DbClient, companyId: string): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += LEAD_PAGE) {
    const page = await listLeads(db, companyId, { status: [...SETTLED_STATUSES], limit: LEAD_PAGE, offset });
    for (const lead of page) ids.add(lead.id);
    if (page.length < LEAD_PAGE) return ids;
  }
}

/** What every batch of one collection shares: the window's end, the mode, and the leads whose outcome is already known. */
interface CollectionContext {
  readonly windowEnd: string;
  readonly sandbox: boolean;
  readonly settled: ReadonlySet<string>;
}

/**
 * CMP-1: a send that bounced marks its lead `bounced` and suppresses the
 * address (`bounce`); a lead that asked to stop is marked `opted_out` and
 * suppressed (`opt_out`). The suppression is written first, so a crash in
 * between leaves a lead that is read again next time, never one marked but
 * not suppressed. Idempotent: a lead already marked is not marked again, an
 * address already suppressed gets no second row. Returns how many sends
 * bounced and how many leads opted out.
 */
async function applyOutcomes(deps: WorkerDeps, companyId: string, batch: OutreachBatch, counts: readonly ReplyCount[]): Promise<{ readonly bounced: number; readonly optedOut: number }> {
  for (const count of counts) {
    const status = count.bounced ? "bounced" : count.optedOut ? "opted_out" : null;
    const leadId = batch.leadIdByMessage[count.messageId];
    const lead = status && leadId ? await getLead(deps.db, companyId, leadId) : null;
    if (!status || !lead) continue;
    await suppressOnce(deps.db, { companyId, email: lead.email, reason: status === "bounced" ? "bounce" : "opt_out", sourceActionId: batch.actionIdByMessage[count.messageId] ?? null });
    if (lead.status !== status) await markLeads(deps.db, companyId, [lead.id], status);
  }
  return { bounced: counts.filter((c) => c.bounced).length, optedOut: counts.filter((c) => !c.bounced && c.optedOut).length };
}

/**
 * One batch's replies as a cumulative channel sample and a ledger window;
 * replied leads are marked. CMP-1: bounces and opt-outs are applied first
 * (whatever the count does) and are not replies; sends whose lead is already
 * bounced or opted out are not read at all. A count that did not grow (or a
 * first window with no reply yet) writes nothing: a reply later withdrawn by
 * an opt-out never makes a negative window.
 */
async function collectBatch(deps: WorkerDeps, companyId: string, batch: OutreachBatch, ctx: CollectionContext): Promise<{ readonly replies: number; readonly newEntry: boolean }> {
  const { windowEnd, sandbox } = ctx;
  const open = batch.messageIds.filter((messageId) => !ctx.settled.has(batch.leadIdByMessage[messageId] ?? ""));
  const auth = await providerAuthFor(deps, companyId, "email.send.first_contact");
  const counts = open.length > 0 ? await deps.integrations.outreach(auth).replies({ companyId, messageIds: open }) : [];
  const outcomes = await applyOutcomes(deps, companyId, batch, counts);
  const plain = counts.filter(isPlainReply);
  const replies = plain.reduce((sum, c) => sum + c.replies, 0);
  const key = `cold_email:${batch.batchId}`;
  const previous = await latestChannelSample(deps.db, companyId, "email_replies", key);
  if (previous ? replies <= previous.value : replies === 0) return { replies, newEntry: false };
  const delta = windowDelta(previous ? { value: previous.value, spendUsd: 0 } : null, { value: replies, spendUsd: 0 });
  const result = await recordAttributionWindow(deps.db, {
    companyId,
    taskId: batch.taskId,
    metricKey: "email_replies",
    provenance: { channel: "cold_email", batchId: batch.batchId, messageIds: [...batch.messageIds], windowEnd, sandbox, raw: { replies, sent: batch.messageIds.length, repliesInWindow: delta.after - delta.before, ...outcomes } },
    samples: [{ metricKey: "emails_sent", value: batch.messageIds.length }],
    before: delta.before,
    after: delta.after,
    costUsd: 0,
    note: `${batch.messageIds.length} first-contact emails, ${replies} replies so far`,
  });
  const repliedLeads = plain.filter((c) => c.replies > 0).flatMap((c) => (batch.leadIdByMessage[c.messageId] ? [batch.leadIdByMessage[c.messageId] as string] : []));
  if (repliedLeads.length > 0) await markLeads(deps.db, companyId, repliedLeads, "replied");
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
  const ctx: CollectionContext = { windowEnd: now.toISOString(), sandbox: deps.integrations.mode === "sandbox", settled: await settledLeads(deps.db, companyId) };
  let entries = 0;
  let totalReplies = 0;
  for (const batch of batches) {
    const collected = await collectBatch(deps, companyId, batch, ctx);
    totalReplies += collected.replies;
    if (collected.newEntry) entries += 1;
  }
  const current = await latestMetric(deps.db, companyId, "email_replies");
  if (entries > 0 || current === null) await recordMetric(deps.db, { companyId, metricKey: "email_replies", value: totalReplies, source: "outreach" });
  return { batches: batches.length, entries, totalReplies };
}
