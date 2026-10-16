// SEC-2: the Agent SDK session store: a run's transcript entries, append-only and service role only (migration 0020).
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { toJson, UuidSchema } from "./json";
import { readAllPages } from "./paging";

/** The largest value of the `seq` column (a Postgres `int`). */
const MAX_SEQ = 2_147_483_647;

/** A session id: 1 to 128 characters, as the column's check says. */
const SessionIdSchema = z.string().min(1).max(128);
/** `""` is the main transcript; a subagent transcript has a path (the column is checked to 256 characters). */
const SubpathSchema = z.string().max(256);
/** One transcript entry is any JSON object; the SDK shapes it (`{ type, uuid?, timestamp?, ... }`) and the store does not look inside. */
const EntrySchema = z.record(z.string(), z.unknown());

export const AppendSessionEntriesInputSchema = z
  .object({
    companyId: UuidSchema,
    sessionId: SessionIdSchema,
    subpath: SubpathSchema.default(""),
    entries: z.array(EntrySchema),
    fromSeq: z.number().int().min(0).max(MAX_SEQ),
  })
  .refine((input) => input.entries.length === 0 || input.fromSeq + input.entries.length - 1 <= MAX_SEQ, {
    message: "the entries would run past the largest seq",
    path: ["entries"],
  });

/** What `appendSessionEntries` takes. `entries` is `unknown` on purpose: the SDK hands over its own entry type and the schema checks each one is an object. */
export interface AppendSessionEntriesInput {
  readonly companyId: string;
  readonly sessionId: string;
  /** `""` (the default) is the main transcript; a subagent transcript has a path. */
  readonly subpath?: string;
  readonly entries: readonly unknown[];
  /** The seq of the first entry; the later ones take the seqs after it. */
  readonly fromSeq: number;
}

/**
 * Worker (service role): stores the run's transcript entries, entry `i` at
 * seq `fromSeq + i` of the session's transcript, and returns the seq after
 * the last one (what the next append passes as `fromSeq`; `fromSeq` itself for
 * an empty batch, which writes nothing). The caller assigns the seqs: a seq
 * already stored for the session and subpath (a replayed or racing append) is
 * refused by the unique key, and the batch is one insert, so a refused or
 * oversized entry (over 256 KB) takes the whole batch with it and nothing is
 * stored. Entries are kept as JSON: `undefined` fields are dropped and key
 * order is not preserved, and a string holding U+0000 is refused (Postgres
 * jsonb cannot store it). Rows are append-only history.
 *
 * Nothing here ties a session id to a company, so a worker that resumes a
 * session checks `sessionCompanyId` against the run's company first.
 */
export async function appendSessionEntries(db: DbClient, raw: AppendSessionEntriesInput): Promise<number> {
  const input = AppendSessionEntriesInputSchema.parse(raw);
  if (input.entries.length === 0) return input.fromSeq;
  const rows = input.entries.map((entry, i) => ({
    company_id: input.companyId,
    session_id: input.sessionId,
    subpath: input.subpath,
    seq: input.fromSeq + i,
    entry: toJson(entry),
  }));
  const { error } = await db.from("agent_session_entries").insert(rows);
  if (error) throw dbError("Could not append session entries", error);
  return input.fromSeq + input.entries.length;
}

/**
 * Worker (service role): every entry of one transcript of a session, ordered
 * by seq (`subpath` `""` is the main transcript). Reads every row, paging past
 * PostgREST's 1000-row cap, so a long transcript is not cut. Empty for a
 * session that has no entries. Returns a frozen array.
 */
export async function readSessionEntries(db: DbClient, sessionId: string, subpath: string = ""): Promise<readonly unknown[]> {
  const id = SessionIdSchema.parse(sessionId);
  const path = SubpathSchema.parse(subpath);
  const rows = await readAllPages(
    (from, to) => db.from("agent_session_entries").select("entry").eq("session_id", id).eq("subpath", path).order("seq").range(from, to),
    "Could not read session entries",
  );
  return Object.freeze(rows.map((row) => row.entry as unknown));
}

/**
 * The company a session's entries were written for, or null when the session
 * has no entries. A worker resuming a session compares this with the run's
 * company before it loads the transcript.
 */
export async function sessionCompanyId(db: DbClient, sessionId: string): Promise<string | null> {
  const id = SessionIdSchema.parse(sessionId);
  const { data, error } = await db.from("agent_session_entries").select("company_id").eq("session_id", id).order("id").limit(1);
  if (error) throw dbError("Could not read the session's company", error);
  return data?.[0]?.company_id ?? null;
}
