import { channelLabel, formatNumber, formatUsd, metricLabel } from "@/lib/labels";
import type { LedgerRowData } from "@/lib/ledger-view";

const when = (iso: string): string => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const signed = (n: number): string => (n > 0 ? `+${formatNumber(n)}` : formatNumber(n));

/**
 * OUT-1: the append-only record of what each campaign or batch changed in
 * which metric, at what cost, with the provider's figures behind it. Newest
 * first; the CSV export carries the same rows.
 */
export function LedgerTable({ rows }: { rows: readonly LedgerRowData[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid="ledger-entries">
      {rows.map((row) => (
        <li key={row.id} className="bg-surface p-4" data-testid="ledger-entry" data-channel={row.channel} data-metric={row.metricKey} data-entry-id={row.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="mono-label text-faint">
              {when(row.createdAt)} · {channelLabel(row.channel)}
            </span>
            <span className="mono-label text-faint" data-testid="entry-cost">
              {formatUsd(row.costUsd)}
            </span>
          </div>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-xl leading-tight" data-testid="entry-what">
              {row.what}
            </span>
            {row.taskTitle ? (
              <span className="text-muted" data-testid="entry-task">
                {row.taskTitle}
              </span>
            ) : null}
          </p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>{metricLabel(row.metricKey)}</span>
            <span className="mono-label text-muted" data-testid="entry-change">
              {formatNumber(row.before)} → {formatNumber(row.after)}
            </span>
            <span className={`mono-label ${row.delta > 0 ? "text-success" : row.delta < 0 ? "text-error" : "text-faint"}`} data-testid="entry-delta">
              {signed(row.delta)}
            </span>
          </p>
          {row.chips.length > 0 ? (
            <p className="mt-3 flex flex-wrap gap-2" data-testid="entry-provenance">
              {row.chips.map((chip) => (
                <span key={chip} className="mono-label hairline px-1.5 py-0.5 text-faint">
                  {chip}
                </span>
              ))}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
