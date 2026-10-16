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

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** U+0000 and lone surrogates become U+FFFD (Postgres jsonb refuses both); valid surrogate pairs stay. */
function cleanString(text: string): { readonly text: string; readonly replaced: number } {
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

/**
 * The SDK `SessionStore` for one company's run. `append` mirrors the batch
 * through the port at the next seq of its transcript (kept per session and
 * subpath, read lazily from the stored count and re-read after a failure, and
 * serialised per transcript so two batches never share a seq); `load` returns
 * the stored entries in order, or null for a session never written. Both refuse
 * a session that belongs to another company. Entries are sanitised for jsonb
 * first and are never dropped. The optional listing and delete methods are
 * omitted: the table is append-only history.
 */
export function createNorthSessionStore(opts: NorthSessionStoreOptions): SessionStore {
  const { companyId, entries: port } = opts;
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  const nextSeq = new Map<string, number>();
  const tails = new Map<string, Promise<void>>();
  const idOf = (key: SessionKey): string => `${key.sessionId}\u0000${key.subpath ?? ""}`;

  /** Runs `task` after every earlier task of the same transcript has settled, whether it passed or not. */
  const serialised = <T>(id: string, task: () => Promise<T>): Promise<T> => {
    const result = (tails.get(id) ?? Promise.resolve()).then(task);
    const tail = result.then(() => undefined, () => undefined);
    tails.set(id, tail);
    void tail.then(() => {
      if (tails.get(id) === tail) tails.delete(id);
    });
    return result;
  };

  const assertOwnSession = async (sessionId: string): Promise<void> => {
    const owner = await port.companyOf(sessionId);
    if (owner !== null && owner !== companyId) throw new Error(`session ${sessionId} belongs to another company`);
  };

  const appendAt = async (key: SessionKey, batch: readonly unknown[]): Promise<void> => {
    await assertOwnSession(key.sessionId);
    const id = idOf(key);
    const subpath = key.subpath ?? "";
    const from = nextSeq.get(id) ?? (await port.read(key.sessionId, subpath)).length;
    try {
      nextSeq.set(id, await port.append(key.sessionId, subpath, batch, from));
    } catch (error) {
      nextSeq.delete(id); // the write may or may not have landed: count the stored rows again next time
      throw error;
    }
  };

  return {
    async append(key: SessionKey, batch: SessionStoreEntry[]): Promise<void> {
      if (batch.length === 0) return;
      const { value, replaced } = sanitizeJson(batch);
      if (replaced > 0) warn(`session ${key.sessionId}: replaced ${replaced} unencodable characters`);
      // queued before any await, so batches reach the port in the order the SDK appended them
      await serialised(idOf(key), () => appendAt(key, value as readonly unknown[]));
    },
    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      await assertOwnSession(key.sessionId);
      const rows = await port.read(key.sessionId, key.subpath ?? "");
      if (rows.length === 0) return null;
      const parsed = StoredEntriesSchema.safeParse(rows);
      if (!parsed.success) throw new Error(`session ${key.sessionId} holds a malformed entry`);
      return parsed.data;
    },
  };
}
