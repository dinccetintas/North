import Link from "next/link";
import type { CompanyRowView } from "@/lib/portfolio-view";

const stateClass = (row: CompanyRowView): string => (row.stateWord === "running" ? "text-success" : row.pausedReason === "user" ? "text-faint" : "text-error");

/** MULTI-1: one row per company with its state, open cards and goal progress; the whole row is the one link into the company. */
export function CompanyRows({ rows }: { rows: readonly CompanyRowView[] }) {
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid="company-list">
      {rows.map((row) => (
        <li key={row.id} data-testid="company-row" data-company-id={row.id} data-status={row.status} data-paused-reason={row.pausedReason}>
          <Link href={`/c/${row.slug}`} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 px-4 py-4 hover:bg-surface">
            <span className="font-display text-2xl">{row.name}</span>
            <span className={`mono-label ${stateClass(row)}`} data-testid="company-state">
              {row.stateWord}
            </span>
            <span className="mono-label text-muted" data-testid="company-pending">
              {row.pending}
            </span>
            {row.goal ? (
              <span className="mono-label flex items-center gap-2 text-faint" data-testid="company-goal" data-percent={row.goal.percent}>
                <span>{row.goal.label}</span>
                <span aria-hidden className="hairline inline-block h-1.5 w-16">
                  <span className="block h-full bg-fg" style={{ width: `${row.goal.percent}%` }} />
                </span>
              </span>
            ) : (
              <span className="mono-label text-faint">no goal yet</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
