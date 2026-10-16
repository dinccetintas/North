import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DIGEST_CHARS, DIGEST_TRUNCATION_MARKER, formatMemoryDigest, listMemoryItems, memoryDigest, searchMemory, writeMemoryItems, type MemoryItemRecord } from "../src/memory";
import { saveClarifications } from "../src/theses";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("memory repository (MEM)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  const thesisText = "Dental clinics lose patients to long waits; a queue app fixes that.";

  beforeAll(async () => {
    owned = await createOwnerWithCompany("memory", thesisText);
    stranger = await createTestUser("memory-stranger");
    await saveClarifications(owned.owner.client, owned.companyId, [{ id: "q1", question: "Who pays?", answer: "The clinic owner" }]);
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("writeMemoryItems stores drafts and returns ids in order", async () => {
    const ids = await writeMemoryItems(service, owned.companyId, [
      { kind: "persona", title: "Clinic owner", content: "Runs two dental clinics, hates no-shows, buys software on recommendation." },
      { kind: "learning", title: "Pricing signal", content: "Owners compared us to a zebra-striped competitor priced per chair." },
    ], "research");
    expect(ids.length).toBe(2);
    const items = await listMemoryItems(owned.owner.client, owned.companyId);
    expect(items.map((i) => i.id).sort()).toEqual([...ids].sort());
    expect(items.every((i) => i.createdByRole === "research")).toBe(true);
    expect(await writeMemoryItems(service, owned.companyId, [], "research")).toEqual([]);
  });

  it("searchMemory finds an item by a word in its content, ranked", async () => {
    const hits = await searchMemory(owned.owner.client, owned.companyId, "zebra");
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ kind: "learning", title: "Pricing signal", department: null });
    expect(hits[0]?.rank).toBeGreaterThan(0);
    expect(await searchMemory(owned.owner.client, owned.companyId, "spaceship")).toEqual([]);
    await expect(searchMemory(owned.owner.client, owned.companyId, "   ")).rejects.toThrow();
  });

  it("searchMemory respects RLS: another owner gets no hits", async () => {
    expect(await searchMemory(stranger.client, owned.companyId, "zebra")).toEqual([]);
  });

  it("memoryDigest starts with the thesis, includes the Q/A and groups items by kind", async () => {
    const digest = await memoryDigest(owned.owner.client, owned.companyId);
    expect(digest.startsWith("# Thesis (v1)")).toBe(true);
    expect(digest).toContain(thesisText);
    expect(digest).toContain("Q: Who pays?\nA: The clinic owner");
    expect(digest.indexOf("## Memory: persona")).toBeLessThan(digest.indexOf("## Memory: learning"));
    expect(digest).toContain("### Clinic owner");
  });

  it("memoryDigest truncates to maxChars with a trailing marker", async () => {
    const digest = await memoryDigest(owned.owner.client, owned.companyId, 120);
    expect(digest.length).toBe(120);
    expect(digest.endsWith(DIGEST_TRUNCATION_MARKER)).toBe(true);
  });

  it("formatMemoryDigest handles a company without a thesis", () => {
    expect(formatMemoryDigest(null, [], 500)).toBe("# Thesis\n(no thesis yet)");
  });
});

describe("memory digest cap (LRN-6)", () => {
  it("LRN-6 the default digest cap is 8000 characters", () => {
    expect(DEFAULT_DIGEST_CHARS).toBe(8000);
  });

  it("LRN-6 formatMemoryDigest cuts a 9,000-character item to the cap and ends with the truncation marker", () => {
    const item: MemoryItemRecord = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "learning",
      title: "Long note",
      content: "x".repeat(9000),
      createdByRole: "research",
      createdAt: "2026-10-16T00:00:00.000Z",
    };
    const digest = formatMemoryDigest(null, [item], DEFAULT_DIGEST_CHARS);
    expect(digest.length).toBeLessThanOrEqual(DEFAULT_DIGEST_CHARS);
    expect(digest.endsWith(DIGEST_TRUNCATION_MARKER)).toBe(true);
  });
});
