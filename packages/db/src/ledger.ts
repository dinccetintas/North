import { METRIC_KEYS, ProvenanceSchema, type LedgerEntry, type MetricKey, type Provenance } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { toJson, UuidSchema } from "./json";

export interface LedgerRecord {
  readonly id: string;
  readonly taskId: string | null;
  readonly metricKey: MetricKey;
  readonly before: number;
  readonly after: number;
  readonly costUsd: number;
  readonly channel: string;
  readonly note: string;
  /** Where the change came from (campaign or batch, window, sandbox flag); null for K0 outcomes. */
  readonly provenance: Provenance | null;
  readonly campaignId: string | null;
  readonly actionId: string | null;
  readonly createdAt: string;
}

export const RecordLedgerEntryInputSchema = z.object({
  companyId: UuidSchema,
  taskId: UuidSchema.nullable().default(null),
  metricKey: z.enum(METRIC_KEYS),
  before: z.number(),
  after: z.number(),
  costUsd: z.number().nonnegative(),
  channel: z.string().trim().min(1).max(100),
  note: z.string().max(2000).default(""),
  provenance: ProvenanceSchema.nullable().default(null),
  campaignId: UuidSchema.nullable().default(null),
  actionId: UuidSchema.nullable().default(null),
});
export type RecordLedgerEntryInput = z.input<typeof RecordLedgerEntryInputSchema>;

export interface ListLedgerOptions {
  readonly limit?: number;
  /** Only entries created in the last N days. */
  readonly sinceDays?: number;
  /** Only entries created at or after this instant (the previous brief or plan); combines with `sinceDays`. */
  readonly sinceIso?: string;
}

const LEDGER_COLUMNS = "id, task_id, metric_key, before_value, after_value, cost_usd, channel, attribution_note, provenance, campaign_id, action_id, created_at";
const DEFAULT_LIMIT = 500;

const LedgerRowSchema = z.object({
  id: z.string(),
  task_id: z.string().nullable(),
  metric_key: z.enum(METRIC_KEYS),
  before_value: z.number(),
  after_value: z.number(),
  cost_usd: z.number(),
  channel: z.string(),
  attribution_note: z.string(),
  provenance: ProvenanceSchema.nullable(),
  campaign_id: z.string().nullable(),
  action_id: z.string().nullable(),
  created_at: z.string(),
});

const toRecord = (row: unknown): LedgerRecord => {
  const r = LedgerRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    taskId: r.task_id,
    metricKey: r.metric_key,
    before: r.before_value,
    after: r.after_value,
    costUsd: r.cost_usd,
    channel: r.channel,
    note: r.attribution_note,
    provenance: r.provenance ? Object.freeze(r.provenance) : null,
    campaignId: r.campaign_id,
    actionId: r.action_id,
    createdAt: r.created_at,
  });
};

/** Appends one outcome ledger entry (append-only table, worker only); returns its id. */
export async function recordLedgerEntry(db: DbClient, input: RecordLedgerEntryInput): Promise<string> {
  const e = RecordLedgerEntryInputSchema.parse(input);
  const { data, error } = await db
    .from("ledger_entries")
    .insert({
      company_id: e.companyId,
      task_id: e.taskId,
      metric_key: e.metricKey,
      before_value: e.before,
      after_value: e.after,
      cost_usd: e.costUsd,
      channel: e.channel,
      attribution_note: e.note,
      provenance: e.provenance ? toJson(e.provenance) : null,
      campaign_id: e.campaignId,
      action_id: e.actionId,
    })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not record ledger entry", error);
  return data.id;
}

/** Ledger entries of the company, newest first, with provenance. */
export async function listLedgerEntries(db: DbClient, companyId: string, opts: ListLedgerOptions = {}): Promise<readonly LedgerRecord[]> {
  const id = UuidSchema.parse(companyId);
  const limit = z.number().int().positive().max(5000).default(DEFAULT_LIMIT).parse(opts.limit);
  const sinceDays = z.number().positive().max(3650).optional().parse(opts.sinceDays);
  const sinceIso = z.iso.datetime({ offset: true }).optional().parse(opts.sinceIso);
  const base = db.from("ledger_entries").select(LEDGER_COLUMNS).eq("company_id", id);
  const byDays = sinceDays === undefined ? base : base.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  const windowed = sinceIso === undefined ? byDays : byDays.gte("created_at", sinceIso);
  const { data, error } = await windowed.order("created_at", { ascending: false }).limit(limit);
  if (error) throw dbError("Could not list ledger entries", error);
  return Object.freeze((data ?? []).map(toRecord));
}

const REPORT_LIMIT = 5000;

/** The last `days` days as core `LedgerEntry` rows (OUT-1): what `channelReport` and `ledgerCsv` read. */
export async function ledgerEntriesForReport(db: DbClient, companyId: string, days = 30): Promise<readonly LedgerEntry[]> {
  const records = await listLedgerEntries(db, companyId, { sinceDays: days, limit: REPORT_LIMIT });
  return Object.freeze(
    records.map((r) =>
      Object.freeze({ taskId: r.taskId ?? "", metricKey: r.metricKey, before: r.before, after: r.after, costUsd: r.costUsd, channel: r.channel, measuredAt: r.createdAt }),
    ),
  );
}
