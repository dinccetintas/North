import { USAGE_ALERT_RATIO } from "@north/core/billing/plans";
import { sandboxCostUsd, usageCostUsd, usageRatio, type Usage } from "@north/core/billing/usage";

/**
 * BIL-2, the spec's cost NFR: the period's inference plus sandbox cost
 * against the plan price, with the 40 % line. Pure; the panel renders it.
 */

export type UsageLike = Pick<Usage, "creditsUsed" | "llmCostUsd" | "sandboxMinutes">;

export interface UsageView {
  readonly runs: number;
  readonly inference: string;
  readonly sandbox: string;
  readonly total: string;
  readonly price: string;
  readonly ratio: number;
  readonly ratioLabel: string;
  /** Width of the bar, 0..100. */
  readonly barPercent: number;
  /** Where the 40 % line sits on the bar. */
  readonly markPercent: number;
  readonly alert: boolean;
  readonly alertCopy: string | null;
  /** A trial has no price, so no ratio. */
  readonly noPrice: boolean;
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

/** "42 %": whole percent, rounded down so the label never claims the line before the ratio crosses it. */
export function percentLabel(ratio: number): string {
  return `${Math.floor(Math.max(0, ratio) * 100 + 1e-9)} %`;
}

export function usageView(usage: UsageLike | null, priceUsd: number): UsageView {
  const cost = { llmCostUsd: usage?.llmCostUsd ?? 0, sandboxMinutes: usage?.sandboxMinutes ?? 0 };
  const ratio = usageRatio(cost, priceUsd);
  const alert = priceUsd > 0 && ratio >= USAGE_ALERT_RATIO;
  return Object.freeze({
    runs: usage?.creditsUsed ?? 0,
    inference: usd(cost.llmCostUsd),
    sandbox: usd(sandboxCostUsd(cost.sandboxMinutes)),
    total: usd(usageCostUsd(cost)),
    price: usd(Math.max(0, priceUsd)),
    ratio,
    ratioLabel: percentLabel(ratio),
    barPercent: Math.min(100, Math.max(0, Math.round(ratio * 1000) / 10)),
    markPercent: USAGE_ALERT_RATIO * 100,
    alert,
    alertCopy: alert ? `Agents used ${percentLabel(ratio)} of your plan price this month` : null,
    noPrice: priceUsd <= 0,
  });
}
