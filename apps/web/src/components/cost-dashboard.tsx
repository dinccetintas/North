import type { CostRowData } from "@/lib/cost-view";
import { formatNumber } from "@/lib/labels";

/** One cell of the row: label above, value below. */
function Cell({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt className="mono-label text-faint">{label}</dt>
      <dd className="mt-0.5 font-display text-xl leading-tight" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

const dayLabel = (day: string): string => day.slice(5).replace("-", "/");

/**
 * OBS-1: what the agents used and cost per company in the last 30 days, from
 * `agent_runs` (one row per run; mock runs cost nothing). By role, and a
 * seven-day bar list so a runaway day is visible at a glance.
 */
export function CostDashboard({ rows }: { rows: readonly CostRowData[] }) {
  if (rows.length === 0) {
    return (
      <p className="border border-surface-border bg-surface p-5 text-muted" data-testid="cost-dashboard">
        No company yet, so no usage.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="cost-dashboard">
      {rows.map((row) => (
        <li key={row.companyId} className="border border-surface-border bg-surface p-5" data-testid="cost-row" data-company-id={row.companyId}>
          <p className="font-display text-xl leading-tight">{row.companyName}</p>
          <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2">
            <Cell label="runs" value={formatNumber(row.runs)} testId="cost-runs" />
            <Cell label="tokens" value={row.tokensLabel} testId="cost-tokens" />
            <Cell label="cost · 30 d" value={row.totalLabel} testId="cost-total" />
          </dl>
          {row.byRole.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1" aria-label="By role">
              {row.byRole.map((r) => (
                <li key={r.role} className="flex items-baseline justify-between gap-4" data-testid="cost-role" data-role={r.role}>
                  <span className="mono-label text-muted">{r.label}</span>
                  <span className="mono-label text-faint">
                    {formatNumber(r.runs)} {r.runs === 1 ? "run" : "runs"} · {r.costLabel}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <ol className="mt-4 flex flex-col gap-1" aria-label="Last seven days">
            {row.byDay.map((d) => (
              <li key={d.day} className="grid grid-cols-[3rem_1fr_auto] items-center gap-x-3" data-testid="cost-day" data-day={d.day} data-runs={d.runs}>
                <span className="mono-label text-faint">{dayLabel(d.day)}</span>
                <span className="hairline h-1.5 w-full" role="presentation">
                  <span className="block h-full bg-fg" style={{ width: `${d.percent}%` }} />
                </span>
                <span className="mono-label text-faint">
                  {formatNumber(d.runs)} · {d.costLabel}
                </span>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}
