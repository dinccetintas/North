import { z } from "zod";
import { SANDBOX_USD_PER_MINUTE, USAGE_ALERT_RATIO } from "./plans";

/**
 * BIL-2: the spec's `usage` table as a projection per user and owner-local
 * month (`localMonth`), written only through `usage_apply` after every run.
 * The panel shows inference plus sandbox cost against the plan price with
 * the 40 % line; `usage-tick` sends one alert per period.
 */
export const USAGE_PERIOD_SCHEMA = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM");

export const UsageSchema = z.object({
  userId: z.uuid(),
  period: USAGE_PERIOD_SCHEMA,
  creditsUsed: z.number().int().nonnegative(),
  llmCostUsd: z.number().nonnegative(),
  sandboxMinutes: z.number().nonnegative(),
  /** When the period's `usage_alert` went out; null until it does. */
  alertedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Usage = z.infer<typeof UsageSchema>;

type UsageCost = Pick<Usage, "llmCostUsd" | "sandboxMinutes">;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Sandbox compute in dollars; only the SDK runtime accrues minutes. */
export function sandboxCostUsd(minutes: number): number {
  return round(minutes * SANDBOX_USD_PER_MINUTE, 2);
}

/** Inference plus sandbox, in dollars. */
export function usageCostUsd(usage: UsageCost): number {
  return round(usage.llmCostUsd + sandboxCostUsd(usage.sandboxMinutes), 2);
}

/** Cost over the plan price, three decimals; 0 when the price is 0 (a trial has no price). */
export function usageRatio(usage: UsageCost, priceUsd: number): number {
  return priceUsd <= 0 ? 0 : round(usageCostUsd(usage) / priceUsd, 3);
}

/** One alert per period: due when the ratio is at or over the line and none went out yet. */
export function usageAlertDue(usage: UsageCost, priceUsd: number, alertedAt: string | null): boolean {
  return alertedAt === null && priceUsd > 0 && usageRatio(usage, priceUsd) >= USAGE_ALERT_RATIO;
}
