/**
 * Time follows the owner's zone (ADR 0011). Everything here is pure and
 * Intl-based so the web, the worker and the database count "today" the same
 * way; an unknown zone falls back to UTC exactly as the database trigger does.
 */

/** The morning brief hour, local to the owner (BRF-1). A per-user hour is M6 work. */
export const BRIEF_HOUR = 7;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const pad2 = (n: number): string => String(n).padStart(2, "0");

function formatter(timezone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone });
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  }
}

interface LocalParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: number;
}

function localParts(timezone: string, now: Date): LocalParts {
  const parts = formatter(timezone).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: Number(get("hour")) };
}

/** The owner's calendar day for `now`, as `YYYY-MM-DD`. */
export function localDay(timezone: string, now: Date): string {
  const { year, month, day } = localParts(timezone, now);
  return `${year}-${month}-${day}`;
}

/** The owner's hour of the day for `now`, 0..23. */
export function localHour(timezone: string, now: Date): number {
  return localParts(timezone, now).hour;
}

/** A `YYYY-MM-DD` day as a UTC-midnight Date; throws on anything else. */
function parseDay(day: string): Date {
  const match = DAY_RE.exec(day);
  if (!match) throw new Error(`not a YYYY-MM-DD day: ${day}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

const formatDay = (date: Date): string => `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

/** Monday = 0 … Sunday = 6. */
const mondayIndex = (date: Date): number => (date.getUTCDay() + 6) % 7;

/** The ISO 8601 week of a `YYYY-MM-DD` day, as `YYYY-Www` (the year is the ISO week-year). */
export function isoWeek(day: string): string {
  const date = parseDay(day);
  // The ISO week of a day is the week of its Thursday.
  const thursday = new Date(date.getTime() + (3 - mondayIndex(date)) * DAY_MS);
  const weekYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstWeekThursday = new Date(firstThursday.getTime() + (3 - mondayIndex(firstThursday)) * DAY_MS);
  const week = 1 + Math.round((thursday.getTime() - firstWeekThursday.getTime()) / (7 * DAY_MS));
  return `${weekYear}-W${pad2(week)}`;
}

/** The Monday of the owner's local week for `now`, as `YYYY-MM-DD`. */
export function weekStartLocal(timezone: string, now: Date): string {
  const today = parseDay(localDay(timezone, now));
  return formatDay(new Date(today.getTime() - mondayIndex(today) * DAY_MS));
}
