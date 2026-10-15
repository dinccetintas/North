import { localDay } from "@north/core/time";
import { roleTitle } from "./labels";

/**
 * OBS-1 view models for the "Usage and cost" section. Pure: the loader asks
 * the db for one `costSummary` per company (30 days), these functions shape
 * it, the `CostDashboard` renders it. Input types are structural so the db
 * summary satisfies them without a dependency.
 */

export const COST_WINDOW_DAYS = 30;
export const COST_BAR_DAYS = 7;

export interface CostRoleLike {
  readonly role: string;
  readonly runs: number;
  readonly costUsd: number;
}

export interface CostDayLike {
  /** `YYYY-MM-DD`. */
  readonly day: string;
  readonly runs: number;
  readonly costUsd: number;
}

export interface CostSummaryLike {
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly byRole: readonly CostRoleLike[];
  readonly byDay: readonly CostDayLike[];
}

export interface CostRoleRow {
  readonly role: string;
  readonly label: string;
  readonly runs: number;
  readonly costLabel: string;
}

export interface CostDayRow {
  readonly day: string;
  readonly runs: number;
  readonly costLabel: string;
  /** Bar width 0..100: by cost, or by runs when nothing cost anything (mock runs). */
  readonly percent: number;
}

export interface CostRowData {
  readonly companyId: string;
  readonly companyName: string;
  readonly runs: number;
  readonly tokens: number;
  readonly tokensLabel: string;
  readonly totalLabel: string;
  readonly byRole: readonly CostRoleRow[];
  readonly byDay: readonly CostDayRow[];
}

/** Always two decimals with thousands separators: "$0.00", "$1,234.50". */
export function formatCostUsd(value: number): string {
  return `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

/** "1.2k" / "3.4M" for token counts; exact below a thousand. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

const DAY_MS = 86_400_000;
/** The zone the days are keyed on when the owner's is unknown; the db summary defaults to the same. */
export const DEFAULT_COST_TIMEZONE = "UTC";

/** The last `count` days in the owner's zone ending today, oldest first (ADR 0011: days follow the owner). */
export function lastDays(count: number, now: Date = new Date(), timezone: string = DEFAULT_COST_TIMEZONE): readonly string[] {
  return Object.freeze(Array.from({ length: count }, (_, i) => localDay(timezone, new Date(now.getTime() - (count - 1 - i) * DAY_MS))));
}

function dayRows(byDay: readonly CostDayLike[], now: Date, timezone: string): readonly CostDayRow[] {
  const days = lastDays(COST_BAR_DAYS, now, timezone).map((day) => {
    const found = byDay.find((d) => d.day === day);
    return { day, runs: found?.runs ?? 0, costUsd: found?.costUsd ?? 0 };
  });
  const maxCost = Math.max(0, ...days.map((d) => d.costUsd));
  const maxRuns = Math.max(0, ...days.map((d) => d.runs));
  const percent = (d: { costUsd: number; runs: number }): number => {
    if (maxCost > 0) return Math.round((d.costUsd / maxCost) * 100);
    if (maxRuns > 0) return Math.round((d.runs / maxRuns) * 100);
    return 0;
  };
  return Object.freeze(days.map((d) => Object.freeze({ day: d.day, runs: d.runs, costLabel: formatCostUsd(d.costUsd), percent: percent(d) })));
}

export function costRow(company: { readonly id: string; readonly name: string }, summary: CostSummaryLike, now: Date = new Date(), timezone: string = DEFAULT_COST_TIMEZONE): CostRowData {
  const tokens = summary.inputTokens + summary.outputTokens;
  const byRole = [...summary.byRole].sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs || a.role.localeCompare(b.role));
  return Object.freeze({
    companyId: company.id,
    companyName: company.name,
    runs: summary.runs,
    tokens,
    tokensLabel: formatTokens(tokens),
    totalLabel: formatCostUsd(summary.costUsd),
    byRole: Object.freeze(byRole.map((r) => Object.freeze({ role: r.role, label: roleTitle(r.role), runs: r.runs, costLabel: formatCostUsd(r.costUsd) }))),
    byDay: dayRows(summary.byDay, now, timezone),
  });
}
