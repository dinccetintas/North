import type { BudgetCategory } from "../authority/action";

/** Snapshot of one budget category at decision time. Amounts in USD. */
export interface BudgetState {
  readonly category: BudgetCategory;
  readonly totalLimitUsd: number;
  readonly dailyLimitUsd: number;
  readonly spentTotalUsd: number;
  readonly spentTodayUsd: number;
}

export interface BudgetHeadroom {
  readonly totalRemainingUsd: number;
  readonly dailyRemainingUsd: number;
}

export function headroom(budget: BudgetState): BudgetHeadroom {
  return Object.freeze({
    totalRemainingUsd: Math.max(0, budget.totalLimitUsd - budget.spentTotalUsd),
    dailyRemainingUsd: Math.max(0, budget.dailyLimitUsd - budget.spentTodayUsd),
  });
}

/** True when spending `amountUsd` would pass the daily or total cap. */
export function wouldExceedBudget(budget: BudgetState, amountUsd: number): boolean {
  const room = headroom(budget);
  return amountUsd > room.dailyRemainingUsd || amountUsd > room.totalRemainingUsd;
}

/** Returns a new budget state with the spend applied (never mutates). */
export function applySpend(budget: BudgetState, amountUsd: number): BudgetState {
  return Object.freeze({
    ...budget,
    spentTotalUsd: budget.spentTotalUsd + amountUsd,
    spentTodayUsd: budget.spentTodayUsd + amountUsd,
  });
}
