import { METRIC_KEYS, type MetricKey } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";

export interface MetricPoint {
  readonly value: number;
  readonly measuredAt: string;
}

export const RecordMetricInputSchema = z.object({
  companyId: UuidSchema,
  metricKey: z.enum(METRIC_KEYS),
  value: z.number(),
  source: z.string().trim().min(1).max(100),
});
export type RecordMetricInput = z.input<typeof RecordMetricInputSchema>;

/** Most recent value of a metric series, or null when nothing was measured yet. */
export async function latestMetric(db: DbClient, companyId: string, metricKey: MetricKey): Promise<MetricPoint | null> {
  const id = UuidSchema.parse(companyId);
  const key = z.enum(METRIC_KEYS).parse(metricKey);
  const { data, error } = await db
    .from("metrics")
    .select("value, measured_at")
    .eq("company_id", id)
    .eq("metric_key", key)
    .order("measured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("Could not load latest metric", error);
  return data ? Object.freeze({ value: data.value, measuredAt: data.measured_at }) : null;
}

/** Appends one measurement to the metric series. */
export async function recordMetric(db: DbClient, input: RecordMetricInput): Promise<void> {
  const m = RecordMetricInputSchema.parse(input);
  const { error } = await db.from("metrics").insert({ company_id: m.companyId, metric_key: m.metricKey, value: m.value, source: m.source });
  if (error) throw dbError("Could not record metric", error);
}
