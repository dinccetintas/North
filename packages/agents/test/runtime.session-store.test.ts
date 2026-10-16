import { describe, expect, it } from "vitest";
import type { ClaudeAgentSdkDeps } from "../src/runtime/claude-agent-sdk";
import { createNorthSessionStore, sanitizeJson } from "../src/runtime/session-store";

type Entries = NonNullable<ClaudeAgentSdkDeps["sessionEntries"]>;

const COMPANY = "company-1";
const key = (sessionId: string, subpath?: string) => ({ projectKey: "p", sessionId, ...(subpath === undefined ? {} : { subpath }) });
const entry = (n: number) => ({ type: "user", uuid: `u${n}`, timestamp: "2026-10-16T10:00:00Z", n });

/** Fake callbacks over arrays, recording every append's `fromSeq`. */
function fakeEntries(owners: Record<string, string> = {}) {
  const rows = new Map<string, unknown[]>();
  const calls: Array<{ sessionId: string; subpath: string; fromSeq: number; count: number }> = [];
  const owner = new Map(Object.entries(owners));
  const at = (sessionId: string, subpath: string) => `${sessionId}\u0000${subpath}`;
  const entries: Entries = {
    async append(sessionId, subpath, batch, fromSeq) {
      calls.push({ sessionId, subpath, fromSeq, count: batch.length });
      const list = rows.get(at(sessionId, subpath)) ?? [];
      if (fromSeq !== list.length) throw new Error(`seq ${fromSeq} already stored`);
      rows.set(at(sessionId, subpath), [...list, ...batch]);
      if (!owner.has(sessionId)) owner.set(sessionId, COMPANY);
      return fromSeq + batch.length;
    },
    async read(sessionId, subpath) {
      return rows.get(at(sessionId, subpath)) ?? [];
    },
    async companyOf(sessionId) {
      return owner.get(sessionId) ?? null;
    },
  };
  return { entries, rows, calls, stored: (sessionId: string, subpath = "") => rows.get(at(sessionId, subpath)) ?? [] };
}

describe("SEC-2 createNorthSessionStore", () => {
  it("appends through the callback with increasing fromSeq", async () => {
    const fake = fakeEntries();
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await store.append(key("s1"), [entry(1), entry(2)]);
    await store.append(key("s1"), [entry(3)]);
    await store.append(key("s1"), [entry(4), entry(5)]);
    expect(fake.calls.map((c) => [c.fromSeq, c.count])).toEqual([[0, 2], [2, 1], [3, 2]]);
    expect(fake.stored("s1")).toHaveLength(5);
  });

  it("loads the entries in order and returns null for a session that was never written", async () => {
    const fake = fakeEntries();
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    expect(await store.load(key("s1"))).toBeNull();
    await store.append(key("s1"), [entry(1), entry(2)]);
    await store.append(key("s1"), [entry(3)]);
    expect(await store.load(key("s1"))).toEqual([entry(1), entry(2), entry(3)]);
  });

  it("continues after the rows already stored when a resumed session is appended to", async () => {
    const fake = fakeEntries({ s1: COMPANY });
    await fake.entries.append("s1", "", [entry(1), entry(2), entry(3)], 0);
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await store.append(key("s1"), [entry(4)]);
    expect(fake.calls.at(-1)).toMatchObject({ fromSeq: 3, count: 1 });
  });

  it("keeps one sequence per subpath; the empty subpath is the main transcript", async () => {
    const fake = fakeEntries();
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await store.append(key("s1"), [entry(1), entry(2)]);
    await store.append(key("s1", "subagents/agent-a"), [entry(3)]);
    await store.append(key("s1", "subagents/agent-a"), [entry(4)]);
    expect(fake.calls.map((c) => [c.subpath, c.fromSeq])).toEqual([["", 0], ["subagents/agent-a", 0], ["subagents/agent-a", 1]]);
    expect(await store.load(key("s1", "subagents/agent-a"))).toEqual([entry(3), entry(4)]);
    expect(await store.load(key("s1"))).toEqual([entry(1), entry(2)]);
  });

  it("serialises concurrent appends of one key so no two batches share a seq", async () => {
    const fake = fakeEntries();
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await Promise.all([store.append(key("s1"), [entry(1), entry(2)]), store.append(key("s1"), [entry(3)]), store.append(key("s1"), [entry(4)])]);
    expect(fake.calls.map((c) => c.fromSeq)).toEqual([0, 2, 3]);
    expect(fake.stored("s1").map((e) => (e as { n: number }).n)).toEqual([1, 2, 3, 4]);
  });

  it("re-reads the stored count after a failed append instead of trusting its own (a timeout may have landed)", async () => {
    const fake = fakeEntries();
    let landedThenTimedOut = true;
    const flaky: Entries = {
      ...fake.entries,
      append: async (sessionId, subpath, batch, fromSeq) => {
        const next = await fake.entries.append(sessionId, subpath, batch, fromSeq);
        if (landedThenTimedOut) {
          landedThenTimedOut = false;
          throw new Error("timeout");
        }
        return next;
      },
    };
    const store = createNorthSessionStore({ companyId: COMPANY, entries: flaky });
    await expect(store.append(key("s1"), [entry(1)])).rejects.toThrow("timeout");
    await store.append(key("s1"), [entry(2)]);
    expect(fake.calls.map((c) => c.fromSeq)).toEqual([0, 1]);
  });

  it("refuses to append to or load a session of another company", async () => {
    const fake = fakeEntries({ foreign: "company-2" });
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await expect(store.append(key("foreign"), [entry(1)])).rejects.toThrow("session foreign belongs to another company");
    await expect(store.load(key("foreign"))).rejects.toThrow("session foreign belongs to another company");
    expect(fake.calls).toEqual([]);
  });

  it("fails loudly on a stored row that is not a transcript entry", async () => {
    const fake = fakeEntries({ s1: COMPANY });
    await fake.entries.append("s1", "", [{ nope: true }], 0);
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await expect(store.load(key("s1"))).rejects.toThrow("session s1 holds a malformed entry");
  });

  it("accepts a new session and one of its own company", async () => {
    const fake = fakeEntries({ mine: COMPANY });
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await expect(store.append(key("fresh"), [entry(1)])).resolves.toBeUndefined();
    await expect(store.append(key("mine"), [entry(1)])).resolves.toBeUndefined();
  });

  it("an empty batch writes nothing", async () => {
    const fake = fakeEntries();
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries });
    await store.append(key("s1"), []);
    expect(fake.calls).toEqual([]);
  });

  it("replaces NUL and a lone surrogate with U+FFFD, warns once per batch with the count, and keeps every entry", async () => {
    const fake = fakeEntries();
    const warnings: string[] = [];
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fake.entries, warn: (m) => warnings.push(m) });
    const nul = { type: "user", uuid: "u1", message: { content: "a\u0000b" } };
    const lone = { type: "assistant", uuid: "u2", parts: ["ok", "x\uD83Dy"] };
    const clean = { type: "system", uuid: "u3" };
    await store.append(key("s1"), [nul, lone, clean]);
    expect(fake.stored("s1")).toEqual([
      { type: "user", uuid: "u1", message: { content: "a�b" } },
      { type: "assistant", uuid: "u2", parts: ["ok", "x�y"] },
      clean,
    ]);
    expect(warnings).toEqual(["session s1: replaced 2 unencodable characters"]);
    expect(nul.message.content).toBe("a\u0000b");
  });

  it("does not warn when nothing needed replacing", async () => {
    const warnings: string[] = [];
    const store = createNorthSessionStore({ companyId: COMPANY, entries: fakeEntries().entries, warn: (m) => warnings.push(m) });
    await store.append(key("s1"), [entry(1)]);
    expect(warnings).toEqual([]);
  });
});

describe("SEC-2 sanitizeJson", () => {
  it("leaves clean values, valid surrogate pairs and non-strings alone", () => {
    const value = { a: "plain", b: ["\u{1F600}", 1, true, null], c: { d: "café" } };
    expect(sanitizeJson(value)).toEqual({ value, replaced: 0 });
  });

  it("replaces NUL, a lone high surrogate and a lone low surrogate, counting each", () => {
    const { value, replaced } = sanitizeJson({ s: "a\u0000b\uD83Dc\uDE00d", nested: [["\u0000"]] });
    expect(value).toEqual({ s: "a�b�c�d", nested: [["�"]] });
    expect(replaced).toBe(4);
  });

  it("keeps a valid pair intact next to a lone surrogate", () => {
    const { value, replaced } = sanitizeJson("\u{1F600}\uD83D");
    expect(value).toBe("\u{1F600}�");
    expect(replaced).toBe(1);
  });

  it("cleans object keys too, since jsonb refuses them as well", () => {
    const { value, replaced } = sanitizeJson({ "k\u0000ey": 1 });
    expect(value).toEqual({ "k�ey": 1 });
    expect(replaced).toBe(1);
  });

  it("returns new objects and never mutates its input", () => {
    const input = Object.freeze({ list: Object.freeze(["a\u0000"]) });
    const { value } = sanitizeJson(input);
    expect(value).not.toBe(input);
    expect(input.list[0]).toBe("a\u0000");
  });
});
