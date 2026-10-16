import { EXPORT_CSV_TABLES, exportDataPath, ledgerCsv, METRIC_KEYS, WorkspacePathSchema, type LedgerEntry, type MetricKey } from "@north/core";
import { EXPORT_TEXT_MAX_CHARS, type DbClient } from "@north/db";
import type { WorkerDeps } from "../../deps";
import { csvHeader, csvLine, withoutHeader } from "./csv";
import { openEntry, type EntrySink, type ManifestFile } from "./files";
import { formatBytes, spentReason, type Cut, type ExportBudget, type Meter } from "./budget";
import { readPage, streamRows, type Row, type RowText, type Streamed } from "./table-stream";
import { COMPANY_COLUMNS, COMPANY_TABLES, PROFILE_TABLES, type ExportTable } from "./tables";

export { EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE, type Row } from "./table-stream";
export { EXPORT_BUDGET, meter, type Cut, type ExportBudget, type Meter } from "./budget";

/**
 * EXP-1 (D6-4): the owner's data as files. Every company table the owner can
 * read becomes `data/<slug>/<name>.json` (the owner-visible columns of
 * `tables.ts`; a JSON array, one row per line), the six `EXPORT_CSV_TABLES`
 * also `.csv` (the ledger through core's `ledgerCsv`, the rest through
 * `csvLine`), and `data/profile.json` holds the profile, entitlement, credit
 * entries, usage and connections. Every path goes through `exportDataPath`.
 * Reads are complete (paged), scoped to one company id or one user id that
 * the caller already proved is the requester's. M6 review M4: rows stream to
 * disk, and every file is held to the budgets; a cut is named in the README.
 */

const charsWord = EXPORT_TEXT_MAX_CHARS.toLocaleString("en-US").replace(/,/g, " ");

export const PROFILE_PATH = WorkspacePathSchema.parse("data/profile.json");

const isMetricKey = (value: unknown): value is MetricKey => typeof value === "string" && (METRIC_KEYS as readonly string[]).includes(value);

/** One ledger row as a core `LedgerEntry` for `ledgerCsv` (the OUT-1 columns), or nothing for a key core does not know. */
const ledgerEntry = (r: Row): readonly LedgerEntry[] =>
  isMetricKey(r.metric_key)
    ? [{ taskId: typeof r.task_id === "string" ? r.task_id : "", metricKey: r.metric_key, before: Number(r.before_value), after: Number(r.after_value), costUsd: Number(r.cost_usd), channel: String(r.channel ?? ""), measuredAt: String(r.created_at ?? "") }]
    : [];

const CSV_NAMES: ReadonlySet<string> = new Set(EXPORT_CSV_TABLES);

const rowText = (spec: ExportTable, csv: boolean) => (row: Row): RowText => ({
  json: JSON.stringify(row),
  csv: !csv ? "" : spec.name === "ledger" ? withoutHeader(ledgerCsv(ledgerEntry(row))) : csvLine(row, spec.columns),
});

const csvHeaderOf = (spec: ExportTable): string => (spec.name === "ledger" ? ledgerCsv([]) : csvHeader(spec.columns));

/** The README lines for one stream: where it stopped and which columns the select cut. */
function cutsOf(path: string, streamed: Streamed, why: string): readonly Cut[] {
  const cuts: Cut[] = [];
  if (streamed.stopped === "budget") cuts.push({ path, reason: `stops at row ${streamed.rows}: ${why}` });
  if (streamed.stopped === "rows") cuts.push({ path, reason: "stops at its first 100 000 rows" });
  for (const c of streamed.cutColumns) cuts.push({ path, reason: `\`${c}\` values longer than ${charsWord} characters are cut` });
  return cuts;
}

interface Written {
  readonly files: readonly ManifestFile[];
  readonly cuts: readonly Cut[];
}

/** The allowance for one table and the reason a cut would give. */
function allowanceOf(budget: ExportBudget, m: Meter): { readonly bytes: number; readonly why: string } {
  const left = m.remaining();
  return left < budget.tableBytes ? { bytes: left, why: `the ${formatBytes(budget.exportBytes)} budget of this export is spent` } : { bytes: budget.tableBytes, why: `the ${formatBytes(budget.tableBytes)} budget per table` };
}

/** A one-row file (`company.json`, `public_page.json`): the object, or null; left out when it does not fit. */
async function writeSingle(dir: string, path: string, value: unknown, budget: ExportBudget, m: Meter): Promise<Written> {
  const content = `${JSON.stringify(value ?? null, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > allowanceOf(budget, m).bytes) return { files: [], cuts: [{ path, reason: spentReason(budget) }] };
  const sink = await openEntry(dir, path, "json");
  await sink.write(content);
  const file = await sink.close();
  m.spend(file.bytes);
  return { files: [file], cuts: [] };
}

/** One table's JSON (and CSV for the six), streamed. */
async function writeTable(db: DbClient, dir: string, slug: string, spec: ExportTable, companyId: string, budget: ExportBudget, m: Meter): Promise<Written> {
  const jsonPath = exportDataPath(slug, spec.name, "json");
  if (spec.name === "public_page") return writeSingle(dir, jsonPath, (await readPage(db, spec, "company_id", companyId, 0, 1))[0], budget, m);
  const withCsv = CSV_NAMES.has(spec.name);
  const head = withCsv ? csvHeaderOf(spec) : "";
  const close = "\n]\n";
  const allowance = allowanceOf(budget, m);
  const fixed = 1 + close.length + Buffer.byteLength(head, "utf8");
  if (allowance.bytes < fixed) return { files: [], cuts: [{ path: jsonPath, reason: spentReason(budget) }] };
  const json = await openEntry(dir, jsonPath, "json");
  const csv = withCsv ? await openEntry(dir, exportDataPath(slug, spec.name, "csv"), "csv") : null;
  await json.write("[");
  if (csv) await csv.write(head);
  const streamed = await streamRows(db, spec, "company_id", companyId, { json, csv, allowance: allowance.bytes - fixed, text: rowText(spec, withCsv), separator: (i) => (i === 0 ? "\n" : ",\n") });
  await json.write(streamed.rows === 0 ? "]\n" : close);
  const files = await closeAll(json, csv);
  m.spend(files.reduce((sum, f) => sum + f.bytes, 0));
  return { files, cuts: cutsOf(jsonPath, streamed, allowance.why) };
}

const closeAll = async (...sinks: readonly (EntrySink | null)[]): Promise<readonly ManifestFile[]> => {
  const files: ManifestFile[] = [];
  for (const sink of sinks) if (sink) files.push(await sink.close());
  return files;
};

export interface CompanyData {
  readonly files: readonly ManifestFile[];
  /** What was cut or left out, for the README. */
  readonly cuts: readonly Cut[];
}

/** `data/<slug>/…` for one company the caller has already checked belongs to the requester, written under `dir`. */
export async function companyDataFiles(deps: Pick<WorkerDeps, "db">, dir: string, company: { readonly id: string; readonly slug: string }, budget: ExportBudget, m: Meter): Promise<CompanyData> {
  const own = await readPage(deps.db, { table: "companies", columns: COMPANY_COLUMNS, order: ["id"] }, "id", company.id, 0, 1);
  const parts: Written[] = [await writeSingle(dir, exportDataPath(company.slug, "company", "json"), own[0], budget, m)];
  for (const spec of COMPANY_TABLES) parts.push(await writeTable(deps.db, dir, company.slug, spec, company.id, budget, m));
  return Object.freeze({ files: Object.freeze(parts.flatMap((p) => p.files)), cuts: Object.freeze(parts.flatMap((p) => p.cuts)) });
}

/** Room kept for the profile's section names and closing brackets. */
const PROFILE_RESERVE = 256;

/** `data/profile.json`: the owner's profile, entitlement, credit entries, usage and connections (no secrets), one JSON object streamed section by section. */
export async function profileDataFile(deps: Pick<WorkerDeps, "db">, dir: string, userId: string, budget: ExportBudget, m: Meter): Promise<CompanyData> {
  const allowance = allowanceOf(budget, m);
  const singles = new Map<string, string>();
  for (const spec of PROFILE_TABLES.filter((t) => t.name === "profile" || t.name === "entitlement")) singles.set(spec.name, JSON.stringify((await readPage(deps.db, spec, spec.key, userId, 0, 1))[0] ?? null));
  const fixed = [...singles.values()].reduce((sum, v) => sum + Buffer.byteLength(v, "utf8"), PROFILE_RESERVE);
  if (allowance.bytes < fixed) return { files: [], cuts: [{ path: PROFILE_PATH, reason: spentReason(budget) }] };
  const sink = await openEntry(dir, PROFILE_PATH, "json");
  const cuts: Cut[] = [];
  await sink.write("{");
  for (const [i, spec] of PROFILE_TABLES.entries()) {
    await sink.write(`${i === 0 ? "\n" : ",\n"}${JSON.stringify(spec.name)}: `);
    const single = singles.get(spec.name);
    if (single !== undefined) {
      await sink.write(single);
      continue;
    }
    await sink.write("[");
    const left = Math.min(allowance.bytes - sink.bytes() - PROFILE_RESERVE, budget.tableBytes);
    const streamed = await streamRows(deps.db, spec, spec.key, userId, { json: sink, csv: null, allowance: Math.max(0, left), text: (row) => ({ json: JSON.stringify(row), csv: "" }), separator: (n) => (n === 0 ? "\n" : ",\n") });
    await sink.write(streamed.rows === 0 ? "]" : "\n]");
    cuts.push(...cutsOf(PROFILE_PATH, streamed, allowance.why).map((c) => ({ ...c, reason: `\`${spec.name}\` ${c.reason}` })));
  }
  await sink.write("\n}\n");
  const file = await sink.close();
  m.spend(file.bytes);
  return Object.freeze({ files: Object.freeze([file]), cuts: Object.freeze(cuts) });
}
