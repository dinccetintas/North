import type { ChannelReportRow } from "@north/core/ledger/attribution";
import { channelLabel, formatNumber, formatUsd, metricLabel } from "@/lib/labels";

const VERDICT_WORDS: Readonly<Record<ChannelReportRow["verdict"], string>> = Object.freeze({
  working: "working",
  not_working: "not working",
  unknown: "too early",
});

const VERDICT_CLASS: Readonly<Record<ChannelReportRow["verdict"], string>> = Object.freeze({
  working: "text-success",
  not_working: "text-error",
  unknown: "text-faint",
});

const signed = (n: number): string => (n > 0 ? `+${formatNumber(n)}` : formatNumber(n));

/** Cost per unit of metric change for the channel; "—" until the metric moved. */
const costPerUnit = (row: ChannelReportRow): string => (row.totalDelta === 0 ? "—" : formatUsd(row.totalCostUsd / Math.abs(row.totalDelta)));

/**
 * OUT-1 / PLN-2: which channel moved which metric per dollar over the window.
 * The verdict is core `channelReport`'s: "too early" below two entries,
 * "working" when the metric went up, "not working" otherwise.
 */
export function ChannelReport({ rows }: { rows: readonly ChannelReportRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid="ledger-channels">
      {rows.map((row) => (
        <li
          key={`${row.channel}|${row.metricKey}`}
          className="grid grid-cols-2 gap-x-4 gap-y-2 bg-surface p-4 sm:grid-cols-[10rem_1fr_auto_auto_auto_auto] sm:items-baseline"
          data-testid="channel-row"
          data-channel={row.channel}
          data-metric={row.metricKey}
          data-verdict={row.verdict}
        >
          <span className="font-display text-xl leading-tight">{channelLabel(row.channel)}</span>
          <span className={`mono-label text-right sm:order-last ${VERDICT_CLASS[row.verdict]}`} data-testid="channel-verdict">
            {VERDICT_WORDS[row.verdict]}
          </span>
          <span className="col-span-2 text-muted sm:col-span-1">{metricLabel(row.metricKey)}</span>
          <span className="mono-label" data-testid="channel-delta">
            {signed(row.totalDelta)}
          </span>
          <span className="mono-label text-right text-faint sm:text-left" data-testid="channel-cost">
            {formatUsd(row.totalCostUsd)}
          </span>
          <span className="mono-label text-faint" data-testid="channel-cost-per-unit">
            {costPerUnit(row)} / unit · {row.entries} {row.entries === 1 ? "entry" : "entries"}
          </span>
        </li>
      ))}
    </ul>
  );
}
