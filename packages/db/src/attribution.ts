import { BUDGET_CATEGORIES, METRIC_KEYS, ProvenanceSchema, provenanceKey } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { IsoDateSchema, toJson, todayIsoDate, UuidSchema } from "./json";

/** What one collection window did (BUD-1, OUT-1): whether it was new, its entry, and whether a cap is now reached. */
export interface AttributionResult {
  readonly duplicate: boolean;
  readonly entryId: string | null;
  readonly capDaily: boolean;
  readonly capTotal: boolean;
}

const SampleSchema = z.object({ metricKey: z.enum(METRIC_KEYS), value: z.number() });

/**
 * One attribution window: the cumulative channel samples of a campaign or batch
 * plus the ledger delta for the window. `category` defaults to `ads` for ad
 * channels and to none for cold email (no money moves); `source` defaults to
 * the channel name.
 */
export const RecordAttributionInputSchema = z
  .object({
    companyId: UuidSchema,
    taskId: UuidSchema.nullable().default(null),
    /** The `campaigns` row (ads) the window belongs to; null for outreach batches. */
    campaignId: UuidSchema.nullable().default(null),
    actionId: UuidSchema.nullable().default(null),
    /** The attributed outcome metric (the task's metric key or `email_replies`). */
    metricKey: z.enum(METRIC_KEYS),
    provenance: ProvenanceSchema,
    /** Cumulative channel samples for the window (spend, impressions, clicks, emails sent); the attributed metric is added by the function. */
    samples: z.array(SampleSchema).max(20).default([]),
    before: z.number(),
    after: z.number(),
    costUsd: z.number().nonnegative(),
    category: z.enum(BUDGET_CATEGORIES).nullable().optional(),
    source: z.string().trim().min(1).max(100).optional(),
    note: z.string().max(2000).default(""),
    day: IsoDateSchema.default(() => todayIsoDate()),
  })
  .transform((i) => ({
    ...i,
    category: i.category === undefined ? (i.provenance.channel === "cold_email" ? null : "ads") : i.category,
    source: i.source ?? i.provenance.channel,
  }));
export type RecordAttributionInput = z.input<typeof RecordAttributionInputSchema>;

const AttributionRpcSchema = z.object({
  duplicate: z.boolean(),
  entry_id: z.string().nullable(),
  cap_daily: z.boolean(),
  cap_total: z.boolean(),
});

/**
 * OUT-1/OUT-2/BUD-1 in one transaction (`record_attribution`, service role
 * only): inserts the channel samples, the ledger entry and applies the spend to
 * the budget with the day roll. A window already recorded for the same
 * (company, metric, source, window end) is reported as `duplicate` and writes
 * nothing, so a retried Inngest step is a no-op.
 */
export async function recordAttributionWindow(db: DbClient, input: RecordAttributionInput): Promise<AttributionResult> {
  const a = RecordAttributionInputSchema.parse(input);
  const payload = toJson({
    company_id: a.companyId,
    task_id: a.taskId,
    campaign_id: a.campaignId,
    action_id: a.actionId,
    metric_key: a.metricKey,
    channel: a.provenance.channel,
    provenance_key: provenanceKey(a.provenance),
    provenance: a.provenance,
    window_end: a.provenance.windowEnd,
    source: a.source,
    samples: a.samples.map((s) => ({ metric_key: s.metricKey, value: s.value })),
    before: a.before,
    after: a.after,
    cost_usd: a.costUsd,
    category: a.category,
    day: a.day,
    note: a.note,
  });
  const { data, error } = await db.rpc("record_attribution", { payload });
  if (error) throw dbError("Could not record attribution window", error);
  const r = AttributionRpcSchema.parse(data);
  return Object.freeze({ duplicate: r.duplicate, entryId: r.entry_id, capDaily: r.cap_daily, capTotal: r.cap_total });
}
