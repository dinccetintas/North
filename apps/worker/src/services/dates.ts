import { localDay } from "@north/core";

/** A calendar day as the database sees it (UTC), `YYYY-MM-DD`; the key of budgets, cap cards and day rolls. Callers pass `deps.clock()` (ADR 0011). */
export const todayIsoDate = (now: Date): string => now.toISOString().slice(0, 10);

/** The owner-local day of `now` (core `localDay`): the key of briefs, the decision quota and the signal week. */
export const localDayOf = (timezone: string, now: Date): string => localDay(timezone, now);

/** True when `day` (`YYYY-MM-DD`) is before `today`. */
export const isBefore = (day: string, today: string): boolean => day < today;
