// TST-1: pure guard for the spend of test runs (staging worker, CI), separate from the product budgets in guard.ts.
import { z } from "zod";

/**
 * Spend of test runs against a cap per calendar day. `day` is a UTC
 * `YYYY-MM-DD`: a long-lived staging worker is capped per day, a CI process
 * (which lives for one run) per run. A `capUsd` of 0 means "no cap". The cost
 * of one run stays the SDK's `maxBudgetUsd` from the role YAML.
 */
export interface TestRunBudget {
  readonly capUsd: number;
  readonly spentUsd: number;
  readonly day: string;
}

/** Boundary check for a budget read from storage or the environment (TST-1). */
export const TestRunBudgetSchema = z.object({
  capUsd: z.number().nonnegative(),
  spentUsd: z.number().nonnegative(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Sums of cents-sized floats drift by about 1e-16; anything under a nano-dollar is noise, not spend. */
const NOISE_USD = 1e-9;

/**
 * True when `nextUsd` would take the day's spend strictly past the cap, so
 * landing exactly on the cap is allowed. A cap of 0 means no cap and never
 * exceeds.
 */
export function wouldExceedTestCap(budget: TestRunBudget, nextUsd: number): boolean {
  if (budget.capUsd === 0) return false;
  return budget.spentUsd + nextUsd - budget.capUsd > NOISE_USD;
}

/** Returns a new budget with the spend added (never mutates). */
export function applyTestSpend(budget: TestRunBudget, usd: number): TestRunBudget {
  return Object.freeze({ ...budget, spentUsd: budget.spentUsd + usd });
}

/**
 * Returns the budget for `day`: a later day resets the spend to 0. The same
 * day, or an earlier one (a skewed clock), keeps the spend, so a clock that
 * steps back and forth never hands out a second allowance.
 */
export function rollDay(budget: TestRunBudget, day: string): TestRunBudget {
  if (day > budget.day) return Object.freeze({ ...budget, spentUsd: 0, day });
  return Object.freeze({ ...budget });
}

/** What is left under the cap today, never negative; unbounded (Infinity) when there is no cap. */
export function remainingTestUsd(budget: TestRunBudget): number {
  if (budget.capUsd === 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, budget.capUsd - budget.spentUsd);
}
