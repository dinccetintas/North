import { EXPORT_TEXT_MAX_CHARS, DbError, type DbClient } from "@north/db";
import type { EntrySink } from "./files";
import type { ExportTable } from "./tables";

/**
 * EXP-1, M6 security review M4: a table leaves the database in pages of
 * `EXPORT_PAGE_SIZE` rows and goes to disk page by page, never whole in
 * memory. Free-text columns are cut in the select (`::export_text`); every
 * row is counted against a byte allowance (the table's budget, or what is
 * left of the export's), and the table stops at the last whole row that
 * fits. What was cut is returned for the README.
 */

export type Row = Readonly<Record<string, unknown>>;

/** Small pages: at most this many rows of capped columns are in memory at once. */
export const EXPORT_PAGE_SIZE = 200;
/** Per table; a table this large is cut and the README says so. */
export const EXPORT_MAX_ROWS = 100_000;

interface Page {
  readonly data: readonly Row[] | null;
  readonly error: { readonly message: string } | null;
}
interface PagedQuery extends PromiseLike<Page> {
  eq(column: string, value: string): PagedQuery;
  order(column: string, opts: { readonly ascending: boolean }): PagedQuery;
  range(from: number, to: number): PagedQuery;
}
/** The typed client cannot take a table name from a list; the specs in `tables.ts` are checked against the schema instead. */
interface UntypedDb {
  from(table: string): { select(columns: string): PagedQuery };
}

type Spec = Pick<ExportTable, "table" | "columns" | "order" | "long">;

/** `column::export_text` for the free-text columns: PostgREST casts, the 0015 domain cuts, the key stays the column's name. */
export const selectList = (spec: Pick<ExportTable, "columns" | "long">): string => spec.columns.map((c) => (spec.long?.includes(c) ? `${c}::export_text` : c)).join(", ");

/** Rows `from`..`from + size - 1` of `spec.table` where `column = value`, in the spec's stable order. */
export async function readPage(db: DbClient, spec: Spec, column: string, value: string, from: number, size: number): Promise<readonly Row[]> {
  const base = (db as unknown as UntypedDb).from(spec.table).select(selectList(spec)).eq(column, value);
  const ordered = spec.order.reduce((q, c) => q.order(c, { ascending: true }), base);
  const { data, error } = await ordered.range(from, from + size - 1);
  if (error) throw new DbError(`Could not export ${spec.table}: ${error.message}`, error);
  return data ?? [];
}

/** What one stream wrote and why it stopped early, if it did. */
export interface Streamed {
  readonly rows: number;
  readonly bytes: number;
  /** `budget` (the allowance ran out) or `rows` (EXPORT_MAX_ROWS); null when every row was written. */
  readonly stopped: "budget" | "rows" | null;
  /** Free-text columns where a value reached EXPORT_TEXT_MAX_CHARS (cut by the select). */
  readonly cutColumns: readonly string[];
}

/** One row as it is written: the JSON element and, for the six, its CSV line. */
export interface RowText {
  readonly json: string;
  readonly csv: string;
}

export interface StreamTarget {
  readonly json: EntrySink;
  readonly csv: EntrySink | null;
  /** Bytes the rows may take, leaving room for the closing text the caller still writes. */
  readonly allowance: number;
  readonly text: (row: Row) => RowText;
  /** Written before the first row (`\n`) and between rows (`,\n`). */
  readonly separator: (index: number) => string;
}

const reachesCap = (spec: Spec, row: Row): readonly string[] => (spec.long ?? []).filter((c) => typeof row[c] === "string" && (row[c] as string).length >= EXPORT_TEXT_MAX_CHARS);

/** Streams every row of `spec.table` where `column = value` into the target, page by page, within its allowance. */
export async function streamRows(db: DbClient, spec: Spec, column: string, value: string, target: StreamTarget): Promise<Streamed> {
  const cut = new Set<string>();
  let rows = 0;
  let bytes = 0;
  for (;;) {
    if (rows >= EXPORT_MAX_ROWS) {
      const more = await readPage(db, spec, column, value, rows, 1);
      return Object.freeze({ rows, bytes, stopped: more.length > 0 ? "rows" : null, cutColumns: Object.freeze([...cut]) });
    }
    const page = await readPage(db, spec, column, value, rows, Math.min(EXPORT_PAGE_SIZE, EXPORT_MAX_ROWS - rows));
    if (page.length === 0) return Object.freeze({ rows, bytes, stopped: null, cutColumns: Object.freeze([...cut]) });
    let json = "";
    let csv = "";
    for (const row of page) {
      const text = target.text(row);
      const element = `${target.separator(rows)}${text.json}`;
      const size = Buffer.byteLength(element, "utf8") + Buffer.byteLength(text.csv, "utf8");
      if (bytes + size > target.allowance) {
        await flush(target, json, csv);
        return Object.freeze({ rows, bytes, stopped: "budget", cutColumns: Object.freeze([...cut]) });
      }
      for (const c of reachesCap(spec, row)) cut.add(c);
      json += element;
      csv += text.csv;
      bytes += size;
      rows += 1;
    }
    await flush(target, json, csv);
  }
}

async function flush(target: StreamTarget, json: string, csv: string): Promise<void> {
  if (json.length > 0) await target.json.write(json);
  if (csv.length > 0 && target.csv) await target.csv.write(csv);
}
