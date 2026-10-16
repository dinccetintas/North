// SEC-2 (0020): the agent session store through the repository and the schema, against the real database.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendSessionEntries, readSessionEntries, sessionCompanyId } from "../src/agentSessions";
import { DbError } from "../src/errors";
import { anon, createOwnerWithCompany, deleteTestUser, raw, service, type OwnedCompany } from "./fixtures";
import { maxRowsServiceClient, POSTGREST_MAX_ROWS } from "./max-rows";

/** An SDK-shaped transcript entry: the store keeps it as it is. */
const entry = (n: number) => ({
  type: n % 2 === 0 ? "user" : "assistant",
  uuid: randomUUID(),
  timestamp: new Date(Date.UTC(2026, 9, 16, 12, 0, n)).toISOString(),
  message: { role: n % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text: `line ${n}` }] },
});
const entries = (from: number, count: number) => Array.from({ length: count }, (_, i) => entry(from + i));
const newSession = () => `sess-${randomUUID()}`;

describe("SEC-2 session store repository", () => {
  let owned: OwnedCompany;
  let rival: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("sessions");
    rival = await createOwnerWithCompany("sessions-rival");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(rival.owner);
  });

  const stored = async (sessionId: string, subpath = "") =>
    (await raw.from("agent_session_entries").select("seq, company_id").eq("session_id", sessionId).eq("subpath", subpath).order("seq")).data as { seq: number; company_id: string }[];

  it("SEC-2 appends 3 entries, then 2 more from seq 3, returns the next seq each time, and reads all 5 back in order", async () => {
    const sessionId = newSession();
    const all = entries(0, 5);
    expect(await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: all.slice(0, 3), fromSeq: 0 })).toBe(3);
    expect(await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: all.slice(3), fromSeq: 3 })).toBe(5);
    const read = await readSessionEntries(service, sessionId);
    expect(read).toEqual(all);
    expect(Object.isFrozen(read)).toBe(true);
    expect((await stored(sessionId)).map((r) => r.seq)).toEqual([0, 1, 2, 3, 4]);
    expect((await stored(sessionId)).every((r) => r.company_id === owned.companyId)).toBe(true);
  });

  it("SEC-2 reads in seq order, not in the order the batches arrived", async () => {
    const sessionId = newSession();
    const all = entries(0, 4);
    await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: all.slice(2), fromSeq: 2 });
    await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: all.slice(0, 2), fromSeq: 0 });
    expect(await readSessionEntries(service, sessionId)).toEqual(all);
  });

  it("SEC-2 an empty batch writes nothing and returns the seq it was given", async () => {
    const sessionId = newSession();
    expect(await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: [], fromSeq: 7 })).toBe(7);
    expect(await readSessionEntries(service, sessionId)).toEqual([]);
    expect(await sessionCompanyId(service, sessionId)).toBeNull();
  });

  it("SEC-2 a session is read by its id only: a session of another company stays apart, an unknown id reads empty, and sessionCompanyId names the owner", async () => {
    const mine = newSession();
    const theirs = newSession();
    const mineEntries = entries(0, 2);
    const theirEntries = entries(10, 3);
    await appendSessionEntries(service, { companyId: owned.companyId, sessionId: mine, entries: mineEntries, fromSeq: 0 });
    await appendSessionEntries(service, { companyId: rival.companyId, sessionId: theirs, entries: theirEntries, fromSeq: 0 });
    expect(await readSessionEntries(service, mine)).toEqual(mineEntries);
    expect(await readSessionEntries(service, theirs)).toEqual(theirEntries);
    expect(await readSessionEntries(service, newSession())).toEqual([]);
    expect(await sessionCompanyId(service, mine)).toBe(owned.companyId);
    expect(await sessionCompanyId(service, theirs)).toBe(rival.companyId);
    expect(await sessionCompanyId(service, newSession())).toBeNull();
  });

  it("SEC-2 a subagent transcript (subpath) has its own seq space inside the same session", async () => {
    const sessionId = newSession();
    const main = entries(0, 3);
    const sub = entries(20, 2);
    await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: main, fromSeq: 0 });
    expect(await appendSessionEntries(service, { companyId: owned.companyId, sessionId, subpath: "subagents/agent-1", entries: sub, fromSeq: 0 })).toBe(2);
    expect(await readSessionEntries(service, sessionId)).toEqual(main);
    expect(await readSessionEntries(service, sessionId, "")).toEqual(main);
    expect(await readSessionEntries(service, sessionId, "subagents/agent-1")).toEqual(sub);
    expect(await readSessionEntries(service, sessionId, "subagents/agent-2")).toEqual([]);
    expect(await sessionCompanyId(service, sessionId)).toBe(owned.companyId);
  });

  it("SEC-2 a seq already used in the session is refused and takes the whole batch with it", async () => {
    const sessionId = newSession();
    const first = entries(0, 3);
    await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: first, fromSeq: 0 });
    await expect(appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: entries(30, 3), fromSeq: 2 })).rejects.toBeInstanceOf(DbError);
    await expect(appendSessionEntries(service, { companyId: rival.companyId, sessionId, entries: entries(30, 1), fromSeq: 0 })).rejects.toBeInstanceOf(DbError);
    expect(await readSessionEntries(service, sessionId)).toEqual(first);
  });

  it("SEC-2 two appends racing for the same seq: exactly one wins and the other's batch is not stored", async () => {
    const sessionId = newSession();
    const a = entries(40, 2);
    const b = entries(50, 2);
    const results = await Promise.allSettled([
      appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: a, fromSeq: 0 }),
      appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: b, fromSeq: 0 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const winner = results[0]?.status === "fulfilled" ? a : b;
    expect(await readSessionEntries(service, sessionId)).toEqual(winner);
  });

  it("SEC-2 a string with a NUL character cannot be stored (jsonb has no U+0000): the append is refused whole", async () => {
    const sessionId = newSession();
    await expect(appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: [entry(0), { type: "user", text: "binary\u0000tail" }], fromSeq: 0 })).rejects.toBeInstanceOf(DbError);
    expect(await readSessionEntries(service, sessionId)).toEqual([]);
  });

  it("SEC-2 refuses what is not a company, a session id, a seq or a list of objects, before any query", async () => {
    const ok = { companyId: owned.companyId, sessionId: newSession(), entries: entries(0, 1), fromSeq: 0 };
    await expect(appendSessionEntries(service, { ...ok, companyId: "not-a-uuid" })).rejects.toThrow();
    for (const sessionId of ["", "s".repeat(129)]) await expect(appendSessionEntries(service, { ...ok, sessionId })).rejects.toThrow();
    for (const fromSeq of [-1, 1.5, Number.NaN, 2_147_483_648]) await expect(appendSessionEntries(service, { ...ok, fromSeq })).rejects.toThrow();
    for (const bad of ["text", null, 42, [entry(0)]]) await expect(appendSessionEntries(service, { ...ok, entries: [entry(0), bad] })).rejects.toThrow();
    await expect(appendSessionEntries(service, { ...ok, entries: "nope" as never })).rejects.toThrow();
    await expect(appendSessionEntries(service, { ...ok, subpath: "p".repeat(257) })).rejects.toThrow();
    await expect(appendSessionEntries(service, { ...ok, fromSeq: 2_147_483_647, entries: entries(0, 2) })).rejects.toThrow();
    await expect(readSessionEntries(service, "")).rejects.toThrow();
    await expect(readSessionEntries(service, "s".repeat(129))).rejects.toThrow();
    await expect(sessionCompanyId(service, "")).rejects.toThrow();
    expect(await readSessionEntries(service, ok.sessionId)).toEqual([]);
  });

  it("SEC-2 the last seq an int column holds is storable, and the call returns the seq after it", async () => {
    const sessionId = newSession();
    expect(await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: entries(0, 1), fromSeq: 2_147_483_647 })).toBe(2_147_483_648);
    expect((await stored(sessionId)).map((r) => r.seq)).toEqual([2_147_483_647]);
  });

  it("SEC-2 an entry over 256 KB is refused by the database and the batch with it; one just under is stored", async () => {
    const sessionId = newSession();
    const big = { type: "user", text: "x".repeat(262_144) };
    await expect(appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: [entry(0), big], fromSeq: 0 })).rejects.toBeInstanceOf(DbError);
    expect(await readSessionEntries(service, sessionId)).toEqual([]);
    const large = { type: "user", text: "x".repeat(250_000) };
    expect(await appendSessionEntries(service, { companyId: owned.companyId, sessionId, entries: [large], fromSeq: 0 })).toBe(1);
    expect(await readSessionEntries(service, sessionId)).toEqual([large]);
    const direct = await raw.from("agent_session_entries").insert({ company_id: owned.companyId, session_id: sessionId, seq: 5, entry: big });
    expect(direct.error?.message).toMatch(/agent_session_entries_entry_check/);
  });

  it("SEC-2 a transcript longer than PostgREST's row cap is read whole, in order", async () => {
    const sessionId = newSession();
    const rows = Array.from({ length: POSTGREST_MAX_ROWS + 1 }, (_, seq) => ({ company_id: owned.companyId, session_id: sessionId, seq, entry: { type: "user", n: seq } }));
    expect((await raw.from("agent_session_entries").insert(rows)).error).toBeNull();
    const capped = maxRowsServiceClient();
    const read = await readSessionEntries(capped.client, sessionId);
    expect(read).toHaveLength(POSTGREST_MAX_ROWS + 1);
    expect(read.map((e) => (e as { n: number }).n)).toEqual(rows.map((r) => r.seq));
    expect(capped.cut).toEqual([]);
    expect(Math.max(...capped.limits)).toBeLessThanOrEqual(POSTGREST_MAX_ROWS);
  });
});

describe("SEC-2 session store schema", () => {
  let owned: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("sessions-schema");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  const insert = (overrides: Record<string, unknown> = {}) =>
    raw.from("agent_session_entries").insert({ company_id: owned.companyId, session_id: newSession(), seq: 0, entry: { type: "user" }, ...overrides }).select("id, subpath, created_at").single();

  it("SEC-2 session_id is 1 to 128 characters, seq is not negative, the entry is required, the company must exist, and subpath defaults to the main transcript", async () => {
    const ok = await insert();
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ subpath: "" });
    expect(typeof ok.data?.id).toBe("number");
    expect(Number.isNaN(Date.parse(String(ok.data?.created_at)))).toBe(false);
    expect((await insert({ session_id: "" })).error?.message).toMatch(/agent_session_entries_session_id_check/);
    expect((await insert({ session_id: "s".repeat(129) })).error?.message).toMatch(/agent_session_entries_session_id_check/);
    expect((await insert({ session_id: "s".repeat(128) })).error).toBeNull();
    expect((await insert({ subpath: "p".repeat(257) })).error?.message).toMatch(/agent_session_entries_subpath_check/);
    expect((await insert({ seq: -1 })).error?.message).toMatch(/agent_session_entries_seq_check/);
    expect((await insert({ entry: null })).error?.code).toBe("23502");
    expect((await insert({ company_id: "00000000-0000-4000-8000-000000000000" })).error?.code).toBe("23503");
    expect((await insert({ id: 1 })).error?.code).toBe("428C9");
  });

  it("SEC-2 (session_id, subpath, seq) is unique", async () => {
    const sessionId = newSession();
    expect((await insert({ session_id: sessionId })).error).toBeNull();
    expect((await insert({ session_id: sessionId })).error?.code).toBe("23505");
    expect((await insert({ session_id: sessionId, subpath: "subagents/a" })).error).toBeNull();
    expect((await insert({ session_id: sessionId, seq: 1 })).error).toBeNull();
  });

  it("SEC-2 entries are append-only: an update and a delete raise, for the service role too", async () => {
    const sessionId = newSession();
    const made = await insert({ session_id: sessionId, entry: { type: "user", text: "first" } });
    const id = made.data?.id;
    expect((await raw.from("agent_session_entries").update({ entry: { type: "user", text: "rewritten" } }).eq("id", id)).error?.message).toMatch(/append-only/);
    expect((await raw.from("agent_session_entries").delete().eq("id", id)).error?.message).toMatch(/append-only/);
    expect((await raw.from("agent_session_entries").delete().eq("session_id", sessionId)).error?.message).toMatch(/append-only/);
    expect((await raw.from("agent_session_entries").select("entry").eq("id", id).single()).data).toEqual({ entry: { type: "user", text: "first" } });
  });

  it("SEC-2 transcripts never reach the browser: a signed-out client and the signed-in owner read no row of any session and cannot write", async () => {
    const sessionId = newSession();
    expect((await insert({ session_id: sessionId })).error).toBeNull();
    const owner = owned.owner.client as unknown as typeof raw;
    for (const client of [anon as unknown as typeof raw, owner]) {
      const bySession = await client.from("agent_session_entries").select("id, entry").eq("session_id", sessionId);
      expect(bySession.data ?? []).toEqual([]);
      expect(bySession.error?.code).toBe("42501");
      const any = await client.from("agent_session_entries").select("id").limit(5);
      expect(any.data ?? []).toEqual([]);
      expect((await client.from("agent_session_entries").insert({ company_id: owned.companyId, session_id: newSession(), seq: 0, entry: { type: "user" } })).error?.code).toBe("42501");
      expect((await client.from("agent_session_entries").update({ seq: 9 }).eq("session_id", sessionId)).error?.code).toBe("42501");
      expect((await client.from("agent_session_entries").delete().eq("session_id", sessionId)).error?.code).toBe("42501");
    }
    expect((await raw.from("agent_session_entries").select("id", { count: "exact", head: true }).eq("session_id", sessionId)).count).toBe(1);
  });
});
