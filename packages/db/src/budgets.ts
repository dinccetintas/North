import { BUDGET_CATEGORIES, BudgetInputSchema, type BudgetCategory, type BudgetInput, type BudgetState } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { IsoDateSchema, todayIsoDate, UuidSchema } from "./json";

const BUDGET_COLUMNS = "category, total_limit_usd, daily_limit_usd, spent_total_usd, spent_today_usd, spent_today_date, daily_extra_usd, daily_extra_date";

const BudgetRowSchema = z.object({
  category: z.enum(BUDGET_CATEGORIES),
  total_limit_usd: z.coerce.number(),
  daily_limit_usd: z.coerce.number(),
  spent_total_usd: z.coerce.number(),
  spent_today_usd: z.coerce.number(),
  spent_today_date: z.string(),
  daily_extra_usd: z.coerce.number(),
  daily_extra_date: z.string(),
});

/**
 * Maps a row to the core `BudgetState`. A stale `spent_today_date` means
 * nothing was spent today; a stale `daily_extra_date` means no cap raise
 * applies today (BUD-3: a raise is for its day only).
 */
export function toBudgetState(row: unknown, today: string = todayIsoDate()): BudgetState {
  const r = BudgetRowSchema.parse(row);
  return Object.freeze({
    category: r.category,
    totalLimitUsd: r.total_limit_usd,
    dailyLimitUsd: r.daily_limit_usd,
    dailyExtraUsd: r.daily_extra_date === today ? r.daily_extra_usd : 0,
    spentTotalUsd: r.spent_total_usd,
    spentTodayUsd: r.spent_today_date === today ? r.spent_today_usd : 0,
  });
}

/**
 * ONB-2: writes the budget lines, one row per category. Existing rows keep
 * their spent amounts; only the limits change (the owner's column grants
 * cover exactly these columns, migration 0008).
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

/**
 * A6-6 (ADR 0011 follow-up): the company owner's date now, as the database
 * computes it (`owner_local_date`, the owner's zone, UTC fallback). Budgets
 * roll on this day.
 */
export async function ownerLocalDate(db: DbClient, companyId: string): Promise<string> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.rpc("owner_local_date", { p_company_id: id });
  if (error) throw dbError("Could not read the owner's local date", error);
  return IsoDateSchema.parse(data);
}

const dayOrOwnerLocal = async (db: DbClient, companyId: string, today: string | undefined): Promise<string> =>
  today === undefined ? ownerLocalDate(db, companyId) : IsoDateSchema.parse(today);

/**
 * Budget state per category, ordered by category name, as the authority engine
 * expects it. "Today" is the owner's local day: pass `localDay(tz, clock())`
 * when the caller has it (the worker), else the database computes it.
 */
export async function listBudgets(db: DbClient, companyId: string, today?: string): Promise<readonly BudgetState[]> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("budgets").select(BUDGET_COLUMNS).eq("company_id", id).order("category", { ascending: true });
  if (error) throw dbError("Could not list budgets", error);
  const day = await dayOrOwnerLocal(db, id, today);
  return Object.freeze((data ?? []).map((row) => toBudgetState(row, day)));
}

/** One category's budget state on the owner's local day (as `listBudgets`), or null when the company has no line for it. */
export async function getBudget(db: DbClient, companyId: string, category: BudgetCategory, today?: string): Promise<BudgetState | null> {
  const id = UuidSchema.parse(companyId);
  const cat = z.enum(BUDGET_CATEGORIES).parse(category);
  const { data, error } = await db.from("budgets").select(BUDGET_COLUMNS).eq("company_id", id).eq("category", cat).maybeSingle();
  if (error) throw dbError("Could not load budget", error);
  return data ? toBudgetState(data, await dayOrOwnerLocal(db, id, today)) : null;
}

/** What the spend functions return: the budget after the write, with both cap flags (BUD-1). */
export interface BudgetSpendResult {
  readonly spentTodayUsd: number;
  readonly spentTotalUsd: number;
  readonly dailyExtraUsd: number;
  readonly dailyLimitEffectiveUsd: number;
  readonly totalLimitUsd: number;
  readonly capDaily: boolean;
  readonly capTotal: boolean;
  /** False when the call's day is already over for the row (an earlier day than its spend or extra day): nothing day-bound was applied (M4 review M1). */
  readonly applied: boolean;
}

export const BudgetSpendInputSchema = z.object({
  companyId: UuidSchema,
  category: z.enum(BUDGET_CATEGORIES),
  amountUsd: z.number().nonnegative(),
  /** The owner-local day the amount belongs to (`localDay(tz, clock())`, required since M6); a later day than the row's rolls today's spend and extra. */
  day: IsoDateSchema,
});
export type BudgetSpendInput = z.input<typeof BudgetSpendInputSchema>;

const BudgetSpendRpcSchema = z.object({
  spent_today: z.coerce.number(),
  spent_total: z.coerce.number(),
  daily_extra: z.coerce.number(),
  daily_limit_effective: z.coerce.number(),
  total_limit: z.coerce.number(),
  cap_daily: z.boolean(),
  cap_total: z.boolean(),
  applied: z.boolean(),
});

const toSpendResult = (data: unknown): BudgetSpendResult => {
  const r = BudgetSpendRpcSchema.parse(data);
  return Object.freeze({
    spentTodayUsd: r.spent_today,
    spentTotalUsd: r.spent_total,
    dailyExtraUsd: r.daily_extra,
    dailyLimitEffectiveUsd: r.daily_limit_effective,
    totalLimitUsd: r.total_limit,
    capDaily: r.cap_daily,
    capTotal: r.cap_total,
    applied: r.applied,
  });
};

/**
 * BUD-1 in the database: adds the amount to the given owner-local day's and the
 * total spend in one locked write (`apply_budget_spend`, service role only) and
 * reports whether a cap is now reached. Owners never write spend columns.
 */
export async function applyBudgetSpend(db: DbClient, input: BudgetSpendInput): Promise<BudgetSpendResult> {
  const s = BudgetSpendInputSchema.parse(input);
  const { data, error } = await db.rpc("apply_budget_spend", { p_company_id: s.companyId, p_category: s.category, p_amount: s.amountUsd, p_day: s.day });
  if (error) throw dbError("Could not apply budget spend", error);
  return toSpendResult(data);
}

/** BUD-3: raises the given owner-local day's effective daily cap by the amount a cap card approved; it resets with the day roll. */
export async function raiseDailyCap(db: DbClient, input: BudgetSpendInput): Promise<BudgetSpendResult> {
  const s = BudgetSpendInputSchema.parse(input);
  const { data, error } = await db.rpc("raise_daily_cap", { p_company_id: s.companyId, p_category: s.category, p_amount: s.amountUsd, p_day: s.day });
  if (error) throw dbError("Could not raise the daily cap", error);
  return toSpendResult(data);
}

/** BUD-3: raises the category's total cap by the amount a cap card approved (permanent). */
export async function raiseTotalCap(db: DbClient, input: Omit<BudgetSpendInput, "day">): Promise<BudgetSpendResult> {
  const s = BudgetSpendInputSchema.omit({ day: true }).parse(input);
  const { data, error } = await db.rpc("raise_total_cap", { p_company_id: s.companyId, p_category: s.category, p_amount: s.amountUsd });
  if (error) throw dbError("Could not raise the total cap", error);
  return toSpendResult(data);
}
