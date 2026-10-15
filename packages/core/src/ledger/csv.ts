import type { LedgerEntry } from "./attribution";

/** Fixed export columns (OUT-1); the order is part of the contract. */
export const LEDGER_CSV_COLUMNS = ["measured_at", "channel", "metric_key", "before", "after", "delta", "cost_usd", "task_id"] as const;

const CRLF = "\r\n";
const FORMULA_LEAD = /^[=+\-@]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One CSV cell. Numbers are written as numbers (they carry no formula). Text
 * that starts with `=`, `+`, `-` or `@` gets a leading single quote and is
 * quoted, so a spreadsheet never evaluates it (formula injection); any cell
 * with a quote, comma or line break is quoted per RFC 4180 with inner quotes
 * doubled.
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const formula = FORMULA_LEAD.test(value);
  const guarded = formula ? `'${value}` : value;
  return formula || NEEDS_QUOTES.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

const row = (e: LedgerEntry): string =>
  [e.measuredAt, e.channel, e.metricKey, e.before, e.after, e.after - e.before, e.costUsd, e.taskId].map(csvCell).join(",");

/** The ledger as text/csv: a header and one line per entry, CRLF-terminated. */
export function ledgerCsv(entries: readonly LedgerEntry[]): string {
  return [LEDGER_CSV_COLUMNS.join(","), ...entries.map(row)].join(CRLF) + CRLF;
}
