import { ledgerCsv, type LedgerEntry } from "@north/core";

/** How far back the export reaches (OUT-1: the ledger page shows 30 days; the file carries the year). */
export const LEDGER_EXPORT_DAYS = 365;

export const LEDGER_EXPORT_FILENAME = (slug: string): string => `ledger-${slug}.csv`;

/**
 * The ledger as a CSV download. The content comes from core `ledgerCsv`
 * (fixed columns, RFC 4180 quoting, formula-injection guard); this only sets
 * the headers: an attachment, private, never cached.
 */
export function ledgerCsvResponse(entries: readonly LedgerEntry[], slug: string): Response {
  return new Response(ledgerCsv(entries), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${LEDGER_EXPORT_FILENAME(slug)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
