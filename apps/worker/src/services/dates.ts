/** Today's calendar day as the database sees it (UTC), `YYYY-MM-DD`; the key of budgets, cap cards and day rolls. */
export const todayIsoDate = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** True when `day` (`YYYY-MM-DD`) is before `today`. */
export const isBefore = (day: string, today: string): boolean => day < today;
