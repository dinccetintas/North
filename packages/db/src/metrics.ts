import { METRIC_KEYS, METRIC_SCOPES, ProvenanceSchema, provenanceKey, type MetricKey, type Provenance } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { toJson, UuidSchema } from "./json";

export interface MetricPoint {
  readonly value: number;
  readonly measuredAt: string;
}

/** A cumulative sample of one campaign or batch (OUT-2); the ledger's window delta comes from two of these. */
export interface ChannelSample {
  readonly metricKey: MetricKey;
  readonly value: number;
  readonly measuredAt: string;
  readonly windowEnd: string;
  readonly provenanceKey: string;
  readonly provenance: Provenance;
}

export const RecordMetricInputSchema = z
  .object({
    companyId: UuidSchema,
    metricKey: z.enum(METRIC_KEYS),
    value: z.number(),
    source: z.string().trim().min(1).max(100),
    /** `company` (default): the company's own series; `channel`: cumulative per campaign or batch, needs provenance. */
    scope: z.enum(METRIC_SCOPES).default("company"),
    provenance: ProvenanceSchema.optional(),
  })
  .refine((m) => (m.scope === "channel") === (m.provenance !== undefined), { message: "channel samples carry provenance; company samples do not", path: ["provenance"] });
export type RecordMetricInput = z.input<typeof RecordMetricInputSchema>;

const ProvenanceKeySchema = z.string().trim().min(1).max(300);
const CHANNEL_COLUMNS = "metric_key, value, measured_at, window_end, provenance_key, provenance";

const ChannelRowSchema = z.object({
  metric_key: z.enum(METRIC_KEYS),
  value: z.number(),
  measured_at: z.string(),
  window_end: z.string(),
  provenance_key: z.string(),
  provenance: ProvenanceSchema,
});

const toSample = (row: unknown): ChannelSample => {
  const r = ChannelRowSchema.parse(row);
  return Object.freeze({ metricKey: r.metric_key, value: r.value, measuredAt: r.measured_at, windowEnd: r.window_end, provenanceKey: r.provenance_key, provenance: Object.freeze(r.provenance) });
};

/** Most recent company-scope value of a metric series, or null when nothing was measured yet. Channel samples never count. */
export async function latestMetric(db: DbClient, companyId: string, metricKey: MetricKey): Promise<MetricPoint | null> {
  const id = UuidSchema.parse(companyId);
  const key = z.enum(METRIC_KEYS).parse(metricKey);
  const { data, error } = await db
    .from("metrics")
    .select("value, measured_at")
    .eq("company_id", id)
    .eq("metric_key", key)
    .eq("scope", "company")
    .order("measured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("Could not load latest metric", error);
  return data ? Object.freeze({ value: data.value, measuredAt: data.measured_at }) : null;
}

/** The company-scope points of one metric in the last `sinceDays` days, oldest first: what `detectMetricDrops` compares. Channel samples never count. */
export async function metricSeries(db: DbClient, companyId: string, metricKey: MetricKey, sinceDays: number): Promise<readonly MetricPoint[]> {
  const id = UuidSchema.parse(companyId);
  const key = z.enum(METRIC_KEYS).parse(metricKey);
  const days = z.number().positive().max(3650).parse(sinceDays);
  const { data, error } = await db
    .from("metrics")
    .select("value, measured_at")
    .eq("company_id", id)
    .eq("metric_key", key)
    .eq("scope", "company")
    .gte("measured_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .order("measured_at", { ascending: true })
    .limit(1000);
  if (error) throw dbError("Could not load metric series", error);
  return Object.freeze((data ?? []).map((row) => Object.freeze({ value: row.value, measuredAt: row.measured_at })));
}

/** Appends one measurement (worker only; owners read). A channel sample's window is unique per source and metric. */
export async function recordMetric(db: DbClient, input: RecordMetricInput): Promise<void> {
  const m = RecordMetricInputSchema.parse(input);
  const channel = m.provenance
    ? { scope: "channel" as const, provenance: toJson(m.provenance), provenance_key: provenanceKey(m.provenance), window_end: m.provenance.windowEnd, measured_at: m.provenance.windowEnd }
    : { scope: "company" as const };
  const { error } = await db.from("metrics").insert({ company_id: m.companyId, metric_key: m.metricKey, value: m.value, source: m.source, ...channel });
  if (error) throw dbError("Could not record metric", error);
}

/** The newest cumulative sample of one metric for one campaign or batch (`provenanceKey`), or null. */
export async function latestChannelSample(db: DbClient, companyId: string, metricKey: MetricKey, key: string): Promise<ChannelSample | null> {
  const id = UuidSchema.parse(companyId);
  const metric = z.enum(METRIC_KEYS).parse(metricKey);
  const pk = ProvenanceKeySchema.parse(key);
  const { data, error } = await db
    .from("metrics")
    .select(CHANNEL_COLUMNS)
    .eq("company_id", id)
    .eq("scope", "channel")
    .eq("metric_key", metric)
    .eq("provenance_key", pk)
    .order("window_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("Could not load channel sample", error);
  return data ? toSample(data) : null;
}

/** Every channel sample of one campaign or batch, newest window first (all metrics), up to `limit`. */
export async function listChannelSamples(db: DbClient, companyId: string, key: string, limit = 50): Promise<readonly ChannelSample[]> {
  const id = UuidSchema.parse(companyId);
  const pk = ProvenanceKeySchema.parse(key);
  const max = z.number().int().positive().max(1000).parse(limit);
  const { data, error } = await db
    .from("metrics")
    .select(CHANNEL_COLUMNS)
    .eq("company_id", id)
    .eq("scope", "channel")
    .eq("provenance_key", pk)
    .order("window_end", { ascending: false })
    .order("metric_key", { ascending: true })
    .limit(max);
  if (error) throw dbError("Could not list channel samples", error);
  return Object.freeze((data ?? []).map(toSample));
}
