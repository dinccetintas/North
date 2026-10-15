import type { BudgetCategory, SpendProfile } from "../authority/action";

/**
 * Snapshot of one budget category at decision time. Amounts in USD.
 * `dailyExtraUsd` is today's cap raise approved by a cap card (BUD-3); it
 * resets with the day roll, so the effective daily limit is
 * `dailyLimitUsd + dailyExtraUsd`.
 */
export interface BudgetState {
  readonly category: BudgetCategory;
  readonly totalLimitUsd: number;
  readonly dailyLimitUsd: number;
  readonly dailyExtraUsd: number;
  readonly spentTotalUsd: number;
  readonly spentTodayUsd: number;
}

export interface BudgetHeadroom {
  readonly totalRemainingUsd: number;
  readonly dailyRemainingUsd: number;
}

/** Which caps are already reached (BUD-1): the collector pauses a campaign on either. */
export interface CapState {
  readonly daily: boolean;
  readonly total: boolean;
}

/** Today's cap including the extra a cap card granted for the day. */
export function effectiveDailyLimit(budget: BudgetState): number {
  return budget.dailyLimitUsd + budget.dailyExtraUsd;
}

export function headroom(budget: BudgetState): BudgetHeadroom {
  return Object.freeze({
    totalRemainingUsd: Math.max(0, budget.totalLimitUsd - budget.spentTotalUsd),
    dailyRemainingUsd: Math.max(0, effectiveDailyLimit(budget) - budget.spentTodayUsd),
  });
}

/**
 * BUD-1: true when the action's per-day spend would pass what is left of today's
 * cap, or its total would pass what is left of the total cap. The two are
 * checked separately: a $50 five-day campaign is $10 against the daily cap.
 */
export function wouldExceedBudget(budget: BudgetState, profile: SpendProfile): boolean {
  const room = headroom(budget);
  return profile.perDayUsd > room.dailyRemainingUsd || profile.totalUsd > room.totalRemainingUsd;
}

/** A cap counts as exceeded once the spend reaches it: nothing more may be spent under it. */
export function capExceeded(budget: BudgetState): CapState {
  return Object.freeze({
    daily: budget.spentTodayUsd >= effectiveDailyLimit(budget),
    total: budget.spentTotalUsd >= budget.totalLimitUsd,
  });
}

/** Returns a new budget state with the spend applied (never mutates). */
export function applySpend(budget: BudgetState, amountUsd: number): BudgetState {
  return Object.freeze({
    ...budget,
    spentTotalUsd: budget.spentTotalUsd + amountUsd,
    spentTodayUsd: budget.spentTodayUsd + amountUsd,
  });
}
