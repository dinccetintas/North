import { EXPORT_CSV_TABLES, exportDataPath, ledgerCsv, METRIC_KEYS, WorkspacePathSchema, type LedgerEntry, type MetricKey } from "@north/core";
import { DbError, type DbClient } from "@north/db";
import type { WorkerDeps } from "../../deps";
import { csvOf } from "./csv";
import { COMPANY_COLUMNS, COMPANY_TABLES, PROFILE_TABLES, type ExportTable } from "./tables";

/**
 * EXP-1 (D6-4): the owner's data as files. Every company table the owner can
 * read becomes `data/<slug>/<name>.json` (the owner-visible columns of
 * `tables.ts`), the six `EXPORT_CSV_TABLES` also `.csv` (the ledger through
 * core's `ledgerCsv`, the rest through `csvOf`), and `data/profile.json`
 * holds the profile, entitlement, credit entries, usage and connections.
 * Every path goes through `exportDataPath`. Reads are complete (paged), not
 * the screens' recency windows, scoped to one company id or one user id that
 * the caller already proved is the requester's.
 */

export type Row = Readonly<Record<string, unknown>>;

export interface DataFile {
  readonly path: string;
  readonly content: string;
  readonly kind: "json" | "csv";
}

export const EXPORT_PAGE_SIZE = 1000;
/** Per table; a table this large is cut and the README says so. */
export const EXPORT_MAX_ROWS = 100_000;

export const PROFILE_PATH = WorkspacePathSchema.parse("data/profile.json");

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

export interface TableRows {
  readonly rows: readonly Row[];
  readonly truncated: boolean;
}

/** Every row of `spec.table` where `column = value`, in pages, up to `EXPORT_MAX_ROWS`. */
export async function readTable(db: DbClient, spec: Pick<ExportTable, "table" | "columns" | "order">, column: string, value: string): Promise<TableRows> {
  const rows: Row[] = [];
  for (let from = 0; from < EXPORT_MAX_ROWS; from += EXPORT_PAGE_SIZE) {
    const base = (db as unknown as UntypedDb).from(spec.table).select(spec.columns.join(", ")).eq(column, value);
    const ordered = spec.order.reduce((q, c) => q.order(c, { ascending: true }), base);
    const { data, error } = await ordered.range(from, Math.min(from + EXPORT_PAGE_SIZE, EXPORT_MAX_ROWS) - 1);
    if (error) throw new DbError(`Could not export ${spec.table}: ${error.message}`, error);
    rows.push(...(data ?? []));
    if ((data ?? []).length < EXPORT_PAGE_SIZE) return Object.freeze({ rows: Object.freeze(rows), truncated: false });
  }
  return Object.freeze({ rows: Object.freeze(rows), truncated: true });
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const isMetricKey = (value: unknown): value is MetricKey => typeof value === "string" && (METRIC_KEYS as readonly string[]).includes(value);

/** Ledger rows as core `LedgerEntry`s for `ledgerCsv` (the OUT-1 columns). */
const ledgerEntries = (rows: readonly Row[]): readonly LedgerEntry[] =>
  rows.flatMap((r) =>
    isMetricKey(r.metric_key)
      ? [{ taskId: typeof r.task_id === "string" ? r.task_id : "", metricKey: r.metric_key, before: Number(r.before_value), after: Number(r.after_value), costUsd: Number(r.cost_usd), channel: String(r.channel ?? ""), measuredAt: String(r.created_at ?? "") }]
      : [],
  );

const CSV_NAMES: ReadonlySet<string> = new Set(EXPORT_CSV_TABLES);

/** One table's files: the JSON always, the CSV for the six. */
function tableFiles(slug: string, spec: ExportTable, rows: readonly Row[]): readonly DataFile[] {
  const single = spec.name === "public_page";
  const files: DataFile[] = [{ path: exportDataPath(slug, spec.name, "json"), content: json(single ? (rows[0] ?? null) : rows), kind: "json" }];
  if (CSV_NAMES.has(spec.name)) {
    const content = spec.name === "ledger" ? ledgerCsv(ledgerEntries(rows)) : csvOf(rows, spec.columns);
    files.push({ path: exportDataPath(slug, spec.name, "csv"), content, kind: "csv" });
  }
  return files;
}

export interface CompanyData {
  readonly files: readonly DataFile[];
  /** Tables cut at `EXPORT_MAX_ROWS`, for the README. */
  readonly truncated: readonly string[];
}

/** `data/<slug>/…` for one company the caller has already checked belongs to the requester. */
export async function companyDataFiles(deps: Pick<WorkerDeps, "db">, company: { readonly id: string; readonly slug: string }): Promise<CompanyData> {
  const own = await readTable(deps.db, { table: "companies", columns: COMPANY_COLUMNS, order: ["id"] }, "id", company.id);
  const files: DataFile[] = [{ path: exportDataPath(company.slug, "company", "json"), content: json(own.rows[0] ?? null), kind: "json" }];
  const truncated: string[] = [];
  for (const spec of COMPANY_TABLES) {
    const { rows, truncated: cut } = await readTable(deps.db, spec, "company_id", company.id);
    if (cut) truncated.push(`${company.slug}/${spec.name}`);
    files.push(...tableFiles(company.slug, spec, rows));
  }
  return Object.freeze({ files: Object.freeze(files), truncated: Object.freeze(truncated) });
}

/** `data/profile.json`: the owner's profile, entitlement, credit entries, usage and connections (no secrets). */
export async function profileDataFile(deps: Pick<WorkerDeps, "db">, userId: string): Promise<DataFile> {
  const sections: Record<string, unknown> = {};
  for (const spec of PROFILE_TABLES) {
    const { rows } = await readTable(deps.db, spec, spec.key, userId);
    sections[spec.name] = spec.name === "profile" || spec.name === "entitlement" ? (rows[0] ?? null) : rows;
  }
  return Object.freeze({ path: PROFILE_PATH, content: json(sections), kind: "json" });
}
