import { randomUUID } from "node:crypto";
import { EXPORT_TEXT_MAX_CHARS, type DbClient } from "@north/db";

/**
 * An in-memory stand-in for the parts of supabase-js the export, retention and
 * purge services touch: PostgREST tables (select / insert / update / upsert /
 * delete with eq, neq, in, is, not, lte, gte, order, range, limit, single),
 * Storage buckets and `auth.admin.deleteUser`. The real `@north/db`
 * repositories run against it, so their Zod parsing and status guards are
 * exercised as they are against Postgres. Embedded selects are refused. Like
 * hosted PostgREST, a select returns at most `maxRows` rows (1000) and a
 * `column::export_text` cast cuts the text at `EXPORT_TEXT_MAX_CHARS`.
 */

export type Row = Record<string, unknown>;

export interface FakeStore {
  readonly tables: Map<string, Row[]>;
  /** `<bucket>/<path>` → bytes. */
  readonly objects: Map<string, Uint8Array>;
  readonly rpc: Map<string, (args: Row) => { data: unknown; error: unknown }>;
  readonly deletedAuthUsers: string[];
  /** Table names (or `storage:<bucket>`) whose next call fails (an outage). */
  readonly failing: Set<string>;
  /** Side effects in order: `storage.remove:<bucket>`, `rpc:<name>`, `auth.deleteUser`. */
  readonly log: string[];
  /** PostgREST's `max_rows`: a select never returns more (a test may lower it to prove paging). */
  maxRows: number;
  /** Every select as `<table>:<rows returned>`, for paging assertions. */
  readonly reads: string[];
  /** Every upload as `<bucket>:<stream|bytes|blob|string>`: an export must stream its zip from the file. */
  readonly uploads: string[];
}

export const emptyStore = (): FakeStore => ({ tables: new Map(), objects: new Map(), rpc: new Map(), deletedAuthUsers: [], failing: new Set(), log: [], maxRows: 1000, reads: [], uploads: [] });

export const rowsOf = (store: FakeStore, table: string): Row[] => {
  const rows = store.tables.get(table) ?? [];
  store.tables.set(table, rows);
  return rows;
};

type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Result = { data: unknown; error: { message: string; code?: string } | null };

const compare = (a: unknown, b: unknown): number => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : String(a) < String(b) ? -1 : 1);
const numericOrString = (a: unknown, b: unknown): number => (typeof a === "number" && typeof b === "number" ? a - b : compare(a, b));

/** `name` or `name::cast`; `export_text` cuts strings as the 0015 domain does, other casts pass the value through. */
function cell(row: Row, column: string): [string, unknown] {
  const [name = column, cast] = column.split("::");
  const value = row[name] ?? null;
  return [name, cast === "export_text" && typeof value === "string" ? value.slice(0, EXPORT_TEXT_MAX_CHARS) : value];
}

function project(row: Row, columns: string | null): Row {
  if (columns === null || columns.trim() === "*") return { ...row };
  if (columns.includes("(")) throw new Error(`fake-postgrest: embedded selects are not supported (${columns})`);
  return Object.fromEntries(columns.split(",").map((c) => c.trim()).filter(Boolean).map((c) => cell(row, c)));
}

class Query implements PromiseLike<Result> {
  private readonly filters: ((row: Row) => boolean)[] = [];
  private readonly orders: { column: string; ascending: boolean }[] = [];
  private columns: string | null = null;
  private returning = false;
  private window: { from: number; to: number } | null = null;
  private singleMode: "single" | "maybe" | null = null;

  constructor(
    private readonly store: FakeStore,
    private readonly table: string,
    private readonly op: Op,
    private readonly payload: Row | Row[] | null = null,
    private readonly conflict: string | null = null,
  ) {}

  select(columns = "*"): this {
    this.columns = columns;
    this.returning = true;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null | boolean): this {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  not(column: string, operator: string, value: unknown): this {
    if (operator !== "is" || value !== null) throw new Error(`fake-postgrest: not.${operator} is not supported`);
    this.filters.push((r) => (r[column] ?? null) !== null);
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== null && r[column] !== undefined && numericOrString(r[column], value) <= 0);
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== null && r[column] !== undefined && numericOrString(r[column], value) >= 0);
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orders.push({ column, ascending: opts.ascending ?? true });
    return this;
  }
  range(from: number, to: number): this {
    this.window = { from, to };
    return this;
  }
  limit(n: number): this {
    this.window = { from: this.window?.from ?? 0, to: (this.window?.from ?? 0) + n - 1 };
    return this;
  }
  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }
  single(): this {
    this.singleMode = "single";
    return this;
  }
  then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(resolve, reject);
  }

  private matching(rows: readonly Row[]): Row[] {
    const hit = rows.filter((r) => this.filters.every((f) => f(r)));
    const sorted = [...hit].sort((a, b) => {
      for (const o of this.orders) {
        const c = compare(a[o.column], b[o.column]);
        if (c !== 0) return o.ascending ? c : -c;
      }
      return 0;
    });
    return this.window ? sorted.slice(this.window.from, this.window.to + 1) : sorted;
  }

  private write(rows: Row[]): Row[] {
    const now = new Date().toISOString();
    if (this.op === "delete") {
      const doomed = new Set(this.matching(rows));
      this.store.tables.set(this.table, rows.filter((r) => !doomed.has(r)));
      return [...doomed];
    }
    if (this.op === "update") {
      const targets = this.matching(rows);
      for (const r of targets) Object.assign(r, this.payload, "updated_at" in r ? { updated_at: now } : {});
      return targets;
    }
    const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]).map((r): Row => ({ id: randomUUID(), created_at: now, ...r }));
    const out: Row[] = [];
    for (const row of incoming) {
      const existing = this.conflict ? rows.find((r) => r[this.conflict as string] === row[this.conflict as string]) : undefined;
      if (existing) Object.assign(existing, row);
      else rows.push(row);
      out.push(existing ?? row);
    }
    return out;
  }

  private execute(): Result {
    if (this.store.failing.has(this.table)) {
      this.store.failing.delete(this.table);
      return { data: null, error: { message: `fake outage on ${this.table}` } };
    }
    const rows = rowsOf(this.store, this.table);
    const affected = this.op === "select" ? this.matching(rows).slice(0, this.store.maxRows) : this.write(rows);
    if (this.op === "select") this.store.reads.push(`${this.table}:${affected.length}`);
    const data = this.op === "select" || this.returning ? affected.map((r) => project(r, this.columns)) : null;
    if (this.singleMode === null || data === null) return { data, error: null };
    if (data.length > 1) return { data: null, error: { message: "more than one row", code: "PGRST116" } };
    if (data.length === 0 && this.singleMode === "single") return { data: null, error: { message: "no rows", code: "PGRST116" } };
    return { data: data[0] ?? null, error: null };
  }
}

const isStream = (body: unknown): body is AsyncIterable<Uint8Array> => typeof body === "object" && body !== null && Symbol.asyncIterator in body && "pipe" in body;

const bodyKind = (body: unknown): string => (isStream(body) ? "stream" : body instanceof Uint8Array ? "bytes" : body instanceof Blob ? "blob" : typeof body);

const toBytes = async (body: unknown): Promise<Uint8Array> => {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (isStream(body)) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    return new Uint8Array(Buffer.concat(chunks));
  }
  throw new Error("fake-postgrest: unsupported upload body");
};

function bucket(store: FakeStore, name: string) {
  const key = (path: string): string => `${name}/${path}`;
  return {
    upload: async (path: string, body: unknown, opts: { upsert?: boolean } = {}) => {
      store.uploads.push(`${name}:${bodyKind(body)}`);
      if (store.failing.has(`storage:${name}`)) {
        store.failing.delete(`storage:${name}`);
        return { data: null, error: { message: "fake storage outage" } };
      }
      if (store.objects.has(key(path)) && !opts.upsert) return { data: null, error: { message: "The resource already exists" } };
      store.objects.set(key(path), await toBytes(body));
      return { data: { path }, error: null };
    },
    download: async (path: string) => {
      const bytes = store.objects.get(key(path));
      return bytes ? { data: new Blob([bytes as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { message: "Object not found" } };
    },
    remove: async (paths: readonly string[]) => {
      store.log.push(`storage.remove:${name}`);
      const removed = paths.filter((p) => store.objects.delete(key(p)));
      return { data: removed.map((name) => ({ name })), error: null };
    },
  };
}

/** The fake as a `DbClient` for `deps.db`. */
export function fakeSupabase(store: FakeStore): DbClient {
  const client = {
    from: (table: string) => ({
      select: (columns = "*") => new Query(store, table, "select").select(columns),
      insert: (rows: Row | Row[]) => new Query(store, table, "insert", rows),
      update: (patch: Row) => new Query(store, table, "update", patch),
      upsert: (rows: Row | Row[], opts: { onConflict?: string } = {}) => new Query(store, table, "upsert", rows, opts.onConflict ?? "id"),
      delete: () => new Query(store, table, "delete"),
    }),
    rpc: async (name: string, args: Row) => {
      store.log.push(`rpc:${name}`);
      const handler = store.rpc.get(name);
      return handler ? handler(args) : { data: null, error: { message: `fake-postgrest: no rpc ${name}` } };
    },
    storage: { from: (name: string) => bucket(store, name) },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          store.log.push("auth.deleteUser");
          store.deletedAuthUsers.push(id);
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };
  return client as unknown as DbClient;
}
