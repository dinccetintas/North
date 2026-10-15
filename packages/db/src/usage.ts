import { USAGE_PERIOD_SCHEMA, UsageSchema, type Usage } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";

/**
 * BIL-2: the spec's `usage` table as a projection per user and owner-local
 * month (`localMonth`). The worker adds every run through `usage_apply`
 * (service role); owners read their rows; `alerted_at` makes the 40 % alert
 * one per period.
 */
const PeriodSchema = USAGE_PERIOD_SCHEMA.refine((p) => Number(p.slice(5)) >= 1 && Number(p.slice(5)) <= 12, "month 01-12");

export const ApplyUsageInputSchema = z.object({
  userId: UuidSchema,
  period: PeriodSchema,
  credits: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  sandboxMinutes: z.number().nonnegative(),
});
export type ApplyUsageInput = z.input<typeof ApplyUsageInputSchema>;

const USAGE_COLUMNS = "user_id, period, credits_used, llm_cost_usd, sandbox_minutes, alerted_at";

const UsageRowSchema = z.object({
  user_id: z.string(),
  period: z.string(),
  credits_used: z.number().int(),
  llm_cost_usd: z.coerce.number(),
  sandbox_minutes: z.coerce.number(),
  alerted_at: z.string().nullable(),
});

const toUsage = (row: unknown): Usage => {
  const r = UsageRowSchema.parse(row);
  return Object.freeze(
    UsageSchema.parse({ userId: r.user_id, period: r.period, creditsUsed: r.credits_used, llmCostUsd: r.llm_cost_usd, sandboxMinutes: r.sandbox_minutes, alertedAt: r.alerted_at === null ? null : new Date(r.alerted_at).toISOString() }),
  );
};

/** Worker only: adds one run's credits, inference cost and sandbox minutes to the month (additive upsert). Returns the month after the write. */
export async function applyUsage(db: DbClient, input: ApplyUsageInput): Promise<Usage> {
  const u = ApplyUsageInputSchema.parse(input);
  const { data, error } = await db.rpc("usage_apply", { p_user_id: u.userId, p_period: u.period, p_credits: u.credits, p_cost_usd: u.costUsd, p_sandbox_minutes: u.sandboxMinutes });
  if (error) throw dbError("Could not apply usage", error);
  return toUsage(data);
}

/** The user's month, or null when nothing ran in it (or it is not the caller's). */
export async function getUsage(db: DbClient, userId: string, period: string): Promise<Usage | null> {
  const id = UuidSchema.parse(userId);
  const p = PeriodSchema.parse(period);
  const { data, error } = await db.from("usage").select(USAGE_COLUMNS).eq("user_id", id).eq("period", p).maybeSingle();
  if (error) throw dbError("Could not load usage", error);
  return data ? toUsage(data) : null;
}

/** The user's last `months` months with usage, newest first. */
export async function listUsage(db: DbClient, userId: string, months = 12): Promise<readonly Usage[]> {
  const id = UuidSchema.parse(userId);
  const limit = z.number().int().positive().max(120).parse(months);
  const { data, error } = await db.from("usage").select(USAGE_COLUMNS).eq("user_id", id).order("period", { ascending: false }).limit(limit);
  if (error) throw dbError("Could not list usage", error);
  return Object.freeze((data ?? []).map(toUsage));
}

/** `usage-tick` (service role): months of these periods whose alert has not gone out yet; the worker checks the ratio per user. */
export async function listUsageToAlert(db: DbClient, periods: readonly string[]): Promise<readonly Usage[]> {
  const ps = z.array(PeriodSchema).min(1).max(12).parse(periods);
  const { data, error } = await db.from("usage").select(USAGE_COLUMNS).in("period", ps).is("alerted_at", null).order("period", { ascending: true }).limit(5000);
  if (error) throw dbError("Could not list usage to alert", error);
  return Object.freeze((data ?? []).map(toUsage));
}

/** Worker only: claims the period's alert. True when this call set `alerted_at`; false when it was already set or the month has no row. */
export async function markUsageAlerted(db: DbClient, userId: string, period: string, at: Date): Promise<boolean> {
  const id = UuidSchema.parse(userId);
  const p = PeriodSchema.parse(period);
  const { data, error } = await db.from("usage").update({ alerted_at: at.toISOString() }).eq("user_id", id).eq("period", p).is("alerted_at", null).select("user_id").maybeSingle();
  if (error) throw dbError("Could not mark usage alerted", error);
  return data !== null;
}
