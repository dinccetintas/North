import { BUDGET_CATEGORIES, BudgetInputSchema, type BudgetInput, type BudgetState } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { todayIsoDate, UuidSchema } from "./json";

const BUDGET_COLUMNS = "category, total_limit_usd, daily_limit_usd, spent_total_usd, spent_today_usd, spent_today_date";

const BudgetRowSchema = z.object({
  category: z.enum(BUDGET_CATEGORIES),
  total_limit_usd: z.coerce.number(),
  daily_limit_usd: z.coerce.number(),
  spent_total_usd: z.coerce.number(),
  spent_today_usd: z.coerce.number(),
  spent_today_date: z.string(),
});

/** Maps a row to the core `BudgetState`; a stale `spent_today_date` means nothing was spent today. */
export function toBudgetState(row: unknown, today: string = todayIsoDate()): BudgetState {
  const r = BudgetRowSchema.parse(row);
  return Object.freeze({
    category: r.category,
    totalLimitUsd: r.total_limit_usd,
    dailyLimitUsd: r.daily_limit_usd,
    spentTotalUsd: r.spent_total_usd,
    spentTodayUsd: r.spent_today_date === today ? r.spent_today_usd : 0,
  });
}

/**
 * ONB-2: writes the budget lines, one row per category. Existing rows keep
 * their spent amounts; only the limits change.
 */
export async function upsertBudgets(db: DbClient, companyId: string, lines: BudgetInput): Promise<void> {
  const id = UuidSchema.parse(companyId);
  const parsed = BudgetInputSchema.parse(lines);
  const rows = parsed.map((line) => ({
    company_id: id,
    category: line.category,
    total_limit_usd: line.totalLimitUsd,
    daily_limit_usd: line.dailyLimitUsd,
  }));
  const { error } = await db.from("budgets").upsert(rows, { onConflict: "company_id,category" });
  if (error) throw dbError("Could not upsert budgets", error);
}

/** Budget state per category, ordered by category name, as the authority engine expects it. */
export async function listBudgets(db: DbClient, companyId: string): Promise<readonly BudgetState[]> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("budgets").select(BUDGET_COLUMNS).eq("company_id", id).order("category", { ascending: true });
  if (error) throw dbError("Could not list budgets", error);
  const today = todayIsoDate();
  return Object.freeze((data ?? []).map((row) => toBudgetState(row, today)));
}
