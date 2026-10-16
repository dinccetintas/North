import { csvCell } from "@north/core";

/**
 * EXP-1: any rows as text/csv with core's cell rules (RFC 4180 quoting,
 * formula injection guarded): numbers as numbers, booleans as `true`/`false`,
 * null as an empty cell, objects as their JSON. The header is `columns`, or
 * every key in first-seen order.
 */
const cellOf = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? csvCell(value) : "";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return csvCell(value);
  return csvCell(JSON.stringify(value));
};

/** The header line (with its CRLF) for `columns`. */
export const csvHeader = (columns: readonly string[]): string => `${columns.map((c) => csvCell(c)).join(",")}\r\n`;

/** One row's line (with its CRLF), the cells in `columns` order. */
export const csvLine = (row: Readonly<Record<string, unknown>>, columns: readonly string[]): string => `${columns.map((c) => cellOf(row[c])).join(",")}\r\n`;

/** A CSV text without its first line (core's `ledgerCsv` always writes the header). */
export const withoutHeader = (text: string): string => text.slice(text.indexOf("\r\n") + 2);

export function csvOf(rows: readonly Readonly<Record<string, unknown>>[], columns?: readonly string[]): string {
  const header = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [header.map((c) => csvCell(c)).join(","), ...rows.map((r) => header.map((c) => cellOf(r[c])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}
