import { localDay } from "@north/core";
import { companyOwnerId, getProfile } from "@north/db";
import type { WorkerDeps } from "../deps";

/** The company owner's IANA zone, UTC when the profile has none (the database's `owner_local_date` falls back the same way). */
export async function ownerTimezone(deps: WorkerDeps, companyId: string): Promise<string> {
  return (await getProfile(deps.db, await companyOwnerId(deps.db, companyId)))?.timezone ?? "UTC";
}

/**
 * The owner-local day (`YYYY-MM-DD`) of the worker's clock (ADR 0011 and its
 * M6 follow-up): the key of budgets (`apply_budget_spend`, `raise_daily_cap`),
 * cap cards, cap pauses and the day roll, the same day the decision quota and
 * the brief use. Callers inside a durable step compute it once there.
 */
export async function ownerDay(deps: WorkerDeps, companyId: string, now: Date = deps.clock()): Promise<string> {
  return localDay(await ownerTimezone(deps, companyId), now);
}

/** The owner-local day of `now` (core `localDay`): the key of briefs, the decision quota and the signal week. */
export const localDayOf = (timezone: string, now: Date): string => localDay(timezone, now);

/** True when `day` (`YYYY-MM-DD`) is before `today`. */
export const isBefore = (day: string, today: string): boolean => day < today;
