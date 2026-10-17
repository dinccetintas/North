import { describe, expect, it, vi } from "vitest";
import { createNorthSessionStore } from "@north/agents";
import type { AppendSessionEntriesInput } from "@north/db";
import { sessionEntriesPort, type SessionRepo } from "../src/services/session-port";

/**
 * SEC-2: the worker's binding of the agents' `SessionEntriesPort` to the
 * session-entries repository. Every append is stored under the run's company,
 * and a read of a session another company wrote is refused before any entry
 * is loaded.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** A repository over maps, recording every call. */
function fakeRepo(owners: Record<string, string> = {}) {
  const appended: AppendSessionEntriesInput[] = [];
  const read: Array<[string, string]> = [];
  const repo: SessionRepo = {
    appendSessionEntries: vi.fn(async (input: AppendSessionEntriesInput) => (appended.push(input), input.fromSeq + input.entries.length)),
    readSessionEntries: vi.fn(async (sessionId: string, subpath: string) => (read.push([sessionId, subpath]), [{ type: "user", uuid: "u1" }])),
    sessionCompanyId: vi.fn(async (sessionId: string) => owners[sessionId] ?? null),
  };
  return { repo, appended, read };
}

describe("SEC-2 sessionEntriesPort", () => {
  it("SEC-1 appends under the run's company and returns the next seq", async () => {
    const fake = fakeRepo();
    const port = sessionEntriesPort(fake.repo);
    expect(await port.append(COMPANY, "s1", "subagents/a", [{ type: "user" }, { type: "assistant" }], 3)).toBe(5);
    expect(fake.appended).toEqual([{ companyId: COMPANY, sessionId: "s1", subpath: "subagents/a", entries: [{ type: "user" }, { type: "assistant" }], fromSeq: 3 }]);
  });

  it("SEC-1 refuses to read a session another company wrote, without loading its entries", async () => {
    const fake = fakeRepo({ foreign: OTHER });
    const port = sessionEntriesPort(fake.repo);
    await expect(port.read(COMPANY, "foreign", "")).rejects.toThrow("session foreign belongs to another company");
    expect(fake.read).toEqual([]);
  });

  it("SEC-1 reads the run's own session and a session nobody has written yet", async () => {
    const fake = fakeRepo({ mine: COMPANY });
    const port = sessionEntriesPort(fake.repo);
    expect(await port.read(COMPANY, "mine", "")).toEqual([{ type: "user", uuid: "u1" }]);
    expect(await port.read(COMPANY, "fresh", "subagents/b")).toHaveLength(1);
    expect(fake.read).toEqual([["mine", ""], ["fresh", "subagents/b"]]);
  });

  it("SEC-2 companyOf passes the repository's answer through", async () => {
    const port = sessionEntriesPort(fakeRepo({ s1: COMPANY }).repo);
    expect(await port.companyOf("s1")).toBe(COMPANY);
    expect(await port.companyOf("s2")).toBeNull();
  });

  it("SEC-2 as the store's port, a resumed session of another company is refused end to end", async () => {
    const fake = fakeRepo({ foreign: OTHER });
    const store = createNorthSessionStore({ companyId: COMPANY, entries: sessionEntriesPort(fake.repo), warn: () => undefined });
    await expect(store.load({ projectKey: "p", sessionId: "foreign" })).rejects.toThrow("belongs to another company");
    await store.append({ projectKey: "p", sessionId: "fresh" }, [{ type: "user", uuid: "u1" }]);
    expect(fake.appended.map((a) => [a.companyId, a.sessionId, a.fromSeq])).toEqual([[COMPANY, "fresh", 1]]);
  });
});
