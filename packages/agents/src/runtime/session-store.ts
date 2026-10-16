// SEC-2: the Agent SDK `SessionStore` over North's append-only session entries.
// The runtime never touches the database: the host injects `SessionEntriesPort`
// (the worker wires it to `@north/db`'s `appendSessionEntries`, `readSessionEntries`
// and `sessionCompanyId`). A store is built per run and bound to that run's company.
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** The three callbacks a host supplies. Seqs are assigned here: `append` stores entry `i` at `fromSeq + i` and returns the next seq. */
export interface SessionEntriesPort {
  append(sessionId: string, subpath: string, entries: readonly unknown[], fromSeq: number): Promise<number>;
  read(sessionId: string, subpath: string): Promise<readonly unknown[]>;
  /** The company a session was written for; null when the session has no entries yet. */
  companyOf(sessionId: string): Promise<string | null>;
}

const REPLACEMENT = "�";

/** Anything `cleanString` would touch: U+0000, or a surrogate half (a valid pair matches too and is kept by the slow path). */
// eslint-disable-next-line no-control-regex -- U+0000 is exactly what Postgres jsonb refuses
const NEEDS_CLEANING = /[\u0000\ud800-\udfff]/;

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** U+0000 and lone surrogates become U+FFFD (Postgres jsonb refuses both); valid surrogate pairs stay. A clean string is returned as it is, unscanned. */
function cleanString(text: string): { readonly text: string; readonly replaced: number } {
  if (!NEEDS_CLEANING.test(text)) return { text, replaced: 0 };
  let out = "";
  let replaced = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) {
      out += text.slice(i, i + 2);
      i += 1;
    } else if (code === 0 || isHighSurrogate(code) || isLowSurrogate(code)) {
      out += REPLACEMENT;
      replaced += 1;
    } else {
      out += text[i];
    }
  }
  return { text: replaced === 0 ? text : out, replaced };
}

/**
 * Makes a JSON-safe value storable in Postgres jsonb: every string, object
 * keys included, has U+0000 and lone surrogates replaced with U+FFFD. Returns
 * a new value (the input is not touched) and how many characters were replaced.
 */
export function sanitizeJson(value: unknown): { readonly value: unknown; readonly replaced: number } {
  let replaced = 0;
  const clean = (text: string): string => {
    const cleaned = cleanString(text);
    replaced += cleaned.replaced;
    return cleaned.text;
  };
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return clean(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, child]) => [clean(key), walk(child)]));
    return node;
  };
  const cleaned = walk(value);
  return { value: cleaned, replaced };
}

const StoredEntriesSchema = z.array(z.looseObject({ type: z.string() }));

/** Options of `createNorthSessionStore`. */
export interface NorthSessionStoreOptions {
  /** The company of the run this store serves; a session of any other company is refused. */
  readonly companyId: string;
  readonly entries: SessionEntriesPort;
  /** Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

/** One transcript of one session: the main one (empty subpath) or a subagent's. */
const transcriptId = (key: SessionKey): string => `${key.sessionId}\u0000${key.subpath ?? ""}`;

/** Runs the tasks of one id strictly one after another, whether the earlier ones passed or not; different ids run side by side. */
function createSerialiser(): <T>(id: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<void>>();
  return (id, task) => {
    const result = (tails.get(id) ?? Promise.resolve()).then(task);
    const tail = result.then(() => undefined, () => undefined);
    tails.set(id, tail);
    void tail.then(() => {
      if (tails.get(id) === tail) tails.delete(id);
    });
    return result;
  };
}

/**
 * Appends a batch at the next seq of its transcript. The seq is read lazily
 * from the stored row count, advanced by what the port returns, and dropped
 * after a failed write: a timed-out write may have landed, so the rows are
 * counted again next time. Callers serialise per transcript.
 */
function createSeqAppender(port: SessionEntriesPort): (key: SessionKey, batch: readonly unknown[]) => Promise<void> {
  const nextSeq = new Map<string, number>();
  return async (key, batch) => {
    const id = transcriptId(key);
    const subpath = key.subpath ?? "";
    const from = nextSeq.get(id) ?? (await port.read(key.sessionId, subpath)).length;
    try {
      nextSeq.set(id, await port.append(key.sessionId, subpath, batch, from));
    } catch (error) {
      nextSeq.delete(id);
      throw error;
    }
  };
}

/** Refuses a session of another company. An own session is remembered, so the db is asked once per session, not once per batch; a refusal is never remembered. */
function createOwnership(port: SessionEntriesPort, companyId: string): { readonly assertOwn: (sessionId: string) => Promise<void>; readonly markOwn: (sessionId: string) => void } {
  const verified = new Set<string>();
  return {
    async assertOwn(sessionId) {
      if (verified.has(sessionId)) return;
      const owner = await port.companyOf(sessionId);
      if (owner !== null && owner !== companyId) throw new Error(`session ${sessionId} belongs to another company`);
      if (owner === companyId) verified.add(sessionId);
    },
    markOwn: (sessionId) => void verified.add(sessionId),
  };
}

/**
 * The SDK `SessionStore` for one company's run. `append` mirrors the batch
 * through the port at the next seq of its transcript, serialised per transcript
 * so two batches never share a seq; `load` returns the stored entries in order,
 * or null for a session never written. Both refuse a session that belongs to
 * another company (asked of the db once per session; a session this store has
 * itself written counts as verified). Entries are sanitised for jsonb first and
 * are never dropped. The optional listing and delete methods are omitted: the
 * table is append-only history.
 */
export function createNorthSessionStore(opts: NorthSessionStoreOptions): SessionStore {
  const { entries: port } = opts;
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  const serialised = createSerialiser();
  const appendAt = createSeqAppender(port);
  const ownership = createOwnership(port, opts.companyId);

  return {
    async append(key: SessionKey, batch: SessionStoreEntry[]): Promise<void> {
      if (batch.length === 0) return;
      const { value, replaced } = sanitizeJson(batch);
      if (replaced > 0) warn(`session ${key.sessionId}: replaced ${replaced} unencodable characters`);
      // queued before any await, so batches reach the port in the order the SDK appended them
      await serialised(transcriptId(key), async () => {
        await ownership.assertOwn(key.sessionId);
        await appendAt(key, value as readonly unknown[]);
        ownership.markOwn(key.sessionId);
      });
    },
    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      await ownership.assertOwn(key.sessionId);
      const rows = await port.read(key.sessionId, key.subpath ?? "");
      if (rows.length === 0) return null;
      const parsed = StoredEntriesSchema.safeParse(rows);
      if (!parsed.success) throw new Error(`session ${key.sessionId} holds a malformed entry`);
      return parsed.data;
    },
  };
}
