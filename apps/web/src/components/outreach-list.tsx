import { formatNumber } from "@/lib/labels";
import type { OutreachRowData } from "@/lib/ledger-view";

const when = (iso: string): string => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * SLS-K2: one row per first-contact batch the CEO approved: how many emails
 * went out from the user's own mailbox and how many replies came back (the
 * cumulative figure of the batch's latest ledger entry).
 */
export function OutreachList({ rows }: { rows: readonly OutreachRowData[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid="ledger-outreach">
      {rows.map((row) => (
        <li key={row.batchId} className="grid grid-cols-2 gap-x-4 gap-y-2 bg-surface p-4 sm:grid-cols-[1fr_auto_auto] sm:items-baseline" data-testid="outreach-row" data-batch-id={row.batchId}>
          <div className="col-span-2 sm:col-span-1">
            <p className="font-display text-xl leading-tight">{row.taskTitle ?? "Outreach batch"}</p>
            <p className="mono-label mt-1 truncate text-faint">
              batch {row.batchId}
              {row.lastSentAt ? ` · sent ${when(row.lastSentAt)}` : ""}
            </p>
          </div>
          <div>
            <p className="mono-label text-faint">sent</p>
            <p className="mt-0.5" data-testid="outreach-sent">
              {formatNumber(row.sent)}
            </p>
          </div>
          <div>
            <p className="mono-label text-faint">replies</p>
            <p className={`mt-0.5 ${row.replies > 0 ? "text-success" : ""}`} data-testid="outreach-replies">
              {formatNumber(row.replies)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
