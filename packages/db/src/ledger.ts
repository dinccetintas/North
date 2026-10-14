import { METRIC_KEYS, type MetricKey } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";

export interface LedgerRecord {
  readonly id: string;
  readonly taskId: string | null;
  readonly metricKey: MetricKey;
  readonly before: number;
  readonly after: number;
  readonly costUsd: number;
  readonly channel: string;
  readonly note: string;
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
});
export type RecordLedgerEntryInput = z.input<typeof RecordLedgerEntryInputSchema>;

const LEDGER_COLUMNS = "id, task_id, metric_key, before_value, after_value, cost_usd, channel, attribution_note, created_at";

const LedgerRowSchema = z.object({
  id: z.string(),
  task_id: z.string().nullable(),
  metric_key: z.enum(METRIC_KEYS),
  before_value: z.number(),
  after_value: z.number(),
  cost_usd: z.number(),
  channel: z.string(),
  attribution_note: z.string(),
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
    createdAt: r.created_at,
  });
};

/** Appends one outcome ledger entry (append-only table); returns its id. */
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
    })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not record ledger entry", error);
  return data.id;
}

/** Ledger entries of the company, newest first. */
export async function listLedgerEntries(db: DbClient, companyId: string): Promise<readonly LedgerRecord[]> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("ledger_entries").select(LEDGER_COLUMNS).eq("company_id", id).order("created_at", { ascending: false });
  if (error) throw dbError("Could not list ledger entries", error);
  return Object.freeze((data ?? []).map(toRecord));
}
