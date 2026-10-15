import { BUDGET_LABELS, formatUsd } from "@/lib/labels";
import type { BudgetRowData } from "@/lib/ledger-view";
import type { BudgetCategory } from "@north/core/authority/action";

const categoryLabel = (category: string): string => (category in BUDGET_LABELS ? BUDGET_LABELS[category as BudgetCategory] : category);

const percent = (spent: number, cap: number): number => (cap <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((spent / cap) * 100))));

/** One cell of the strip: label above, value below. */
function Cell({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt className="mono-label text-faint">{label}</dt>
      <dd className="mt-0.5" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * BUD-1 at a glance: per category, what was spent today against today's cap
 * (including a cap card's raise) and in total against the total cap. The
 * state word is the raw value the collector acts on: `ok` or `cap_reached`.
 */
export function BudgetStrip({ rows }: { rows: readonly BudgetRowData[] }) {
  if (rows.length === 0) {
    return (
      <p className="border border-surface-border bg-surface p-5 text-muted" data-testid="ledger-budget">
        No budget set yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid="ledger-budget">
      {rows.map((row) => (
        <li key={row.category} className="bg-surface p-4" data-testid="budget-row" data-category={row.category} data-state={row.state}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-display text-xl leading-tight">{categoryLabel(row.category)}</span>
            <span className={`mono-label ${row.state === "cap_reached" ? "text-warning" : "text-success"}`} data-testid="budget-state">
              {row.state}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Cell label="spent today" value={formatUsd(row.spentTodayUsd)} testId="budget-spent-today" />
            <Cell label="daily cap" value={formatUsd(row.dailyCapUsd)} testId="budget-daily-cap" />
            <Cell label="spent total" value={formatUsd(row.spentTotalUsd)} testId="budget-spent-total" />
            <Cell label="total cap" value={formatUsd(row.totalCapUsd)} testId="budget-total-cap" />
          </dl>
          <div
            className="hairline mt-3 h-1.5 w-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent(row.spentTodayUsd, row.dailyCapUsd)}
            aria-label={`${percent(row.spentTodayUsd, row.dailyCapUsd)}% of today's ${categoryLabel(row.category)} cap`}
          >
            <div className={`h-full ${row.state === "cap_reached" ? "bg-warning" : "bg-fg"}`} style={{ width: `${percent(row.spentTodayUsd, row.dailyCapUsd)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
