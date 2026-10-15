import { capExceeded, effectiveDailyLimit, type BudgetState } from "@north/core";

/**
 * BUD-1 in code, mirroring the database trigger `campaigns_within_budget`
 * (migration 0008): a campaign may become active only when its daily budget
 * fits today's effective cap and neither cap is already reached. Today's spend
 * is not subtracted: after a cap raise a campaign resumes with its original
 * daily budget against the raised cap. Returns the refusal, or null when the
 * activation is allowed.
 */
export function activationRefusal(budget: BudgetState | null, dailyBudgetUsd: number): string | null {
  if (!budget) return "no ads budget for this company";
  const daily = effectiveDailyLimit(budget);
  if (dailyBudgetUsd > daily) return `daily budget $${dailyBudgetUsd} exceeds today's ${budget.category} cap $${daily}`;
  const cap = capExceeded(budget);
  if (cap.daily) return `today's ${budget.category} cap $${daily} is spent ($${budget.spentTodayUsd})`;
  if (cap.total) return `the ${budget.category} total cap $${budget.totalLimitUsd} is spent ($${budget.spentTotalUsd})`;
  return null;
}

/** Thrown by `performAction` before any provider is touched when a cap refuses the spend (BUD-3: stop first, ask second). */
export class BudgetCapReachedError extends Error {
  constructor(reason: string) {
    super(`budget cap: ${reason}`);
    this.name = "BudgetCapReachedError";
  }
}
