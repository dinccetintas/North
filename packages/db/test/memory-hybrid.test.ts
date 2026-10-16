import type { MemoryDraft } from "@north/core";
import { MemoryDraftSchema } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { listMemoryItems, searchMemory, searchMemoryHybrid, writeMemoryItems } from "../src/memory";
import { anon, createOwnerWithCompany, createTestUser, deleteTestUser, raw, service, type OwnedCompany, type TestUser } from "./fixtures";

/**
 * 0021_m7_memory_embeddings.sql (LRN-7): memory items carry a 384-dimension
 * embedding (gte-small, written by the `embed` Edge Function; these tests set
 * it directly), `search_memory_hybrid` fuses full-text and cosine ranks with
 * RRF, an insert or a title/content update enqueues one embedding job, and a
 * retired or expired item never reaches a search.
 */
const DIM = 384;
/** A unit vector on one axis of the 384-dimension space; two different axes are orthogonal. */
const axis = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));

async function seed(companyId: string, drafts: readonly MemoryDraft[]): Promise<readonly string[]> {
  return writeMemoryItems(service, companyId, drafts, "research");
}

async function setEmbedding(id: string, vector: readonly number[] | null): Promise<void> {
  const { error } = await service.from("memory_items").update({ embedding: vector === null ? null : JSON.stringify(vector) }).eq("id", id);
  if (error) throw new Error(`setEmbedding failed: ${error.message}`);
}

async function setColumns(id: string, columns: Record<string, unknown>): Promise<void> {
  const { error } = await raw.from("memory_items").update(columns).eq("id", id);
  if (error) throw new Error(`setColumns failed: ${error.message}`);
}

/** Messages waiting on the `embedding_jobs` queue, read through the service-role-only SQL function. */
async function queueDepth(): Promise<number> {
  const { data, error } = await service.rpc("embedding_queue_depth");
  if (error) throw new Error(`embedding_queue_depth failed: ${error.message}`);
  return Number(data);
}

const ids = (hits: readonly { readonly id: string }[]): string[] => hits.map((h) => h.id);

/** What `util.process_embeddings` POSTs to the `embed` Edge Function: `ids` and `msgIds` side by side. */
const RequestBodySchema = z.object({
  ids: z.array(z.string()),
  msgIds: z.array(z.number()),
  schema: z.string(),
  table: z.string(),
  contentFunction: z.string(),
  embeddingColumn: z.string(),
});
type RequestBody = z.infer<typeof RequestBodySchema>;

/** A job read with a one second visibility timeout is invisible for one second, so wait a little longer. */
const VISIBILITY_WAIT_MS = 1200;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One pass of the processor's reader (`util.next_embedding_batches`) without the HTTP call, hiding what it reads for one second. */
async function claimBatches(batchSize = 100, requests = 1): Promise<RequestBody[]> {
  const { data, error } = await service.rpc("embedding_jobs_claim", { p_batch_size: batchSize, p_requests: requests, p_vt_seconds: 1 });
  if (error) throw new Error(`embedding_jobs_claim failed: ${error.message}`);
  return (data ?? []).map((row) => RequestBodySchema.parse((row as { body: unknown }).body));
}

async function ackJobs(msgIds: readonly number[]): Promise<number> {
  const { data, error } = await service.rpc("embedding_jobs_ack", { p_msg_ids: [...msgIds] });
  if (error) throw new Error(`embedding_jobs_ack failed: ${error.message}`);
  return Number(data);
}

/** Removes what earlier tests left on the queue, so a test reads only its own jobs. */
async function drainQueue(): Promise<void> {
  for (let pass = 0; pass < 100; pass++) {
    const bodies = await claimBatches();
    if (bodies.length === 0) return;
    await ackJobs(bodies.flatMap((body) => body.msgIds));
  }
  throw new Error("the embedding queue did not drain");
}

describe("LRN-7 hybrid memory search", () => {
  const owners: TestUser[] = [];
  let stranger: TestUser;

  async function freshCompany(label: string): Promise<OwnedCompany> {
    const owned = await createOwnerWithCompany(label);
    owners.push(owned.owner);
    return owned;
  }

  beforeAll(async () => {
    stranger = await createTestUser("hybrid-stranger");
    owners.push(stranger);
  });

  afterAll(async () => {
    for (const owner of owners) await deleteTestUser(owner);
  });

  it("fuses the full-text rank and the cosine rank: item 2 by meaning, item 3 by the word, item 1 last", async () => {
    const { owner, companyId } = await freshCompany("hybrid-rrf");
    const [one, two, three] = await seed(companyId, [
      { kind: "doc", title: "Quarterly filing dates", content: "The accountant needs the invoices by the fifth." },
      { kind: "preference", title: "Short emails", content: "The founder wants every email under one hundred words." },
      { kind: "learning", title: "Pricing signal", content: "Owners compared us to a zebra-striped competitor priced per chair." },
    ]);
    await Promise.all([setEmbedding(one!, axis(0)), setEmbedding(two!, axis(1)), setEmbedding(three!, axis(2))]);

    const hits = await searchMemoryHybrid(owner.client, companyId, "zebra", axis(1));

    expect(ids(hits)).toEqual([three, two, one]);
    expect(hits[0]).toMatchObject({ kind: "learning", title: "Pricing signal", department: null });
    expect(hits[0]!.rank).toBeGreaterThan(hits[1]!.rank);
    expect(hits[1]!.rank).toBeGreaterThan(hits[2]!.rank);
  });

  it("an item with no embedding is still found by its words, and the semantic leg ignores it", async () => {
    const { owner, companyId } = await freshCompany("hybrid-null-embedding");
    const [plain, vectored] = await seed(companyId, [
      { kind: "learning", title: "Unvectored", content: "A pelican nests on the clinic roof." },
      { kind: "learning", title: "Vectored", content: "Another pelican, this one on the hospital roof." },
    ]);
    await setEmbedding(vectored!, axis(5));

    expect(ids(await searchMemoryHybrid(owner.client, companyId, "pelican", axis(5)))).toEqual([vectored, plain]);
    expect(ids(await searchMemoryHybrid(owner.client, companyId, "heron", axis(5)))).toEqual([vectored]);
  });

  it("without an embedding the call is the full-text search", async () => {
    const { owner, companyId } = await freshCompany("hybrid-null-query");
    await seed(companyId, [
      { kind: "learning", title: "Pricing signal", content: "Owners compared us to a zebra-striped competitor priced per chair." },
      { kind: "persona", title: "Clinic owner", content: "Runs two clinics; the zebra poster hangs in both." },
      { kind: "doc", title: "Unrelated", content: "Nothing to see here." },
    ]);

    const hybrid = await searchMemoryHybrid(owner.client, companyId, "zebra", null);
    const fullText = await searchMemory(owner.client, companyId, "zebra");

    expect(hybrid.length).toBe(2);
    expect(hybrid).toEqual(fullText);
    expect(await searchMemoryHybrid(owner.client, companyId, "spaceship", null)).toEqual([]);
  });

  it("returns the department of a hit from both searches", async () => {
    const { owner, companyId } = await freshCompany("hybrid-department");
    const [tagged, untagged] = await seed(companyId, [
      { kind: "learning", title: "Cold email", content: "Subject lines with a quokka question got replies." },
      { kind: "learning", title: "Landing page", content: "A quokka photo lifted signups." },
    ]);
    await setColumns(tagged!, { department: "sales" });
    await setEmbedding(tagged!, axis(3));
    await setEmbedding(untagged!, axis(4));

    const hybrid = await searchMemoryHybrid(owner.client, companyId, "quokka", axis(3));
    const fullText = await searchMemory(owner.client, companyId, "quokka");

    expect(hybrid.map((h) => [h.id, h.department])).toEqual([[tagged, "sales"], [untagged, null]]);
    expect(fullText.map((h) => h.department).sort()).toEqual([null, "sales"]);
  });

  it("a retired or expired item is excluded from the full-text and the hybrid search and from the listing (so from the digest); a future expiry is not excluded", async () => {
    const { owner, companyId } = await freshCompany("hybrid-retired");
    const [live, retired, expired, later] = await seed(companyId, [
      { kind: "learning", title: "Live", content: "The narwhal subject line works." },
      { kind: "learning", title: "Retired", content: "The narwhal subject line failed." },
      { kind: "learning", title: "Expired", content: "The narwhal discount ended." },
      { kind: "learning", title: "Later", content: "The narwhal sale ends next year." },
    ]);
    await Promise.all([live!, retired!, expired!, later!].map((id, i) => setEmbedding(id, axis(10 + i))));
    await setColumns(retired!, { status: "retired" });
    await setColumns(expired!, { valid_until: new Date(Date.now() - 60_000).toISOString() });
    await setColumns(later!, { valid_until: new Date(Date.now() + 86_400_000).toISOString() });

    const wanted = [live, later].sort();
    expect(ids(await searchMemory(owner.client, companyId, "narwhal")).sort()).toEqual(wanted);
    expect(ids(await searchMemoryHybrid(owner.client, companyId, "narwhal", axis(11))).sort()).toEqual(wanted);
    expect(ids(await searchMemoryHybrid(owner.client, companyId, "narwhal", null)).sort()).toEqual(wanted);
    expect(ids(await searchMemoryHybrid(owner.client, companyId, "something else entirely", axis(11))).sort()).toEqual(wanted);
    const listed = (await listMemoryItems(owner.client, companyId)).map((i) => i.id);
    expect(listed).toContain(live);
    expect(listed).toContain(later);
    expect(listed).not.toContain(retired);
    expect(listed).not.toContain(expired);
  });

  it("RLS: another owner finds nothing through either leg", async () => {
    const { companyId } = await freshCompany("hybrid-rls");
    const [item] = await seed(companyId, [{ kind: "learning", title: "Secret", content: "The platypus supplier is confidential." }]);
    await setEmbedding(item!, axis(20));

    expect(await searchMemoryHybrid(stranger.client, companyId, "platypus", axis(20))).toEqual([]);
    expect(ids(await searchMemoryHybrid(service, companyId, "platypus", axis(20)))).toEqual([item]);
  });

  it("limits the result and caps it at 50", async () => {
    const { owner, companyId } = await freshCompany("hybrid-limit");
    const drafts = Array.from({ length: 5 }, (_, i): MemoryDraft => ({ kind: "doc", title: `Note ${i}`, content: `Lemur note number ${i}.` }));
    const created = await seed(companyId, drafts);
    await Promise.all(created.map((id, i) => setEmbedding(id, axis(30 + i))));

    expect((await searchMemoryHybrid(owner.client, companyId, "lemur", axis(30), 2)).length).toBe(2);
    expect((await searchMemoryHybrid(owner.client, companyId, "lemur", axis(30))).length).toBe(5);
    await expect(searchMemoryHybrid(owner.client, companyId, "lemur", axis(30), 51)).rejects.toThrow();
    await expect(searchMemoryHybrid(owner.client, companyId, "lemur", axis(30), 0)).rejects.toThrow();
  });

  it("validates the query and the embedding before the database sees them", async () => {
    const { owner, companyId } = await freshCompany("hybrid-validate");
    await expect(searchMemoryHybrid(owner.client, companyId, "   ", axis(0))).rejects.toThrow();
    await expect(searchMemoryHybrid(owner.client, companyId, "ok", axis(0).slice(1))).rejects.toThrow();
    await expect(searchMemoryHybrid(owner.client, companyId, "ok", [...axis(0).slice(1), Number.NaN])).rejects.toThrow();
    await expect(searchMemoryHybrid(owner.client, companyId, "ok", [...axis(0).slice(1), Number.POSITIVE_INFINITY])).rejects.toThrow();
    await expect(searchMemoryHybrid(owner.client, "not-a-uuid", "ok", axis(0))).rejects.toThrow();
  });

  it("a signed-out caller cannot run search_memory_hybrid, read the queue, acknowledge jobs or claim them", async () => {
    const { companyId } = await freshCompany("hybrid-anon");
    const hybrid = await anon.rpc("search_memory_hybrid", { p_company_id: companyId, p_query: "anything", p_embedding: JSON.stringify(axis(0)) });
    expect(hybrid.error?.code).toBe("42501");
    const plain = await anon.rpc("search_memory", { p_company_id: companyId, p_query: "anything" });
    expect(plain.error?.code).toBe("42501");
    expect((await anon.rpc("embedding_queue_depth")).error?.code).toBe("42501");
    expect((await anon.rpc("embedding_jobs_ack", { p_msg_ids: [1] })).error?.code).toBe("42501");
    expect((await anon.rpc("embedding_jobs_claim")).error?.code).toBe("42501");
  });

  it("the preference kind is a memory kind in the schema, the draft schema and the repository", async () => {
    const { owner, companyId } = await freshCompany("hybrid-preference");
    expect(MemoryDraftSchema.safeParse({ kind: "preference", title: "Tone", content: "Plain words." }).success).toBe(true);
    const [id] = await seed(companyId, [{ kind: "preference", title: "Tone", content: "The founder prefers plain words." }]);
    const listed = await listMemoryItems(owner.client, companyId);
    expect(listed.map((i) => [i.id, i.kind])).toEqual([[id, "preference"]]);
    expect((await searchMemory(owner.client, companyId, "plain")).map((h) => h.kind)).toEqual(["preference"]);

    const unknown = await raw.from("memory_items").insert({ company_id: companyId, kind: "rumour", title: "x", content: "y" });
    expect(unknown.error?.message).toMatch(/memory_items_kind_check/);
  });

  it("an insert enqueues one embedding job per row; a title or content update enqueues one more; the embedding write does not", async () => {
    const { companyId } = await freshCompany("hybrid-queue");
    const start = await queueDepth();

    const [first] = await seed(companyId, [{ kind: "doc", title: "One", content: "First note." }]);
    expect(await queueDepth()).toBe(start + 1);

    const [second, third] = await seed(companyId, [
      { kind: "doc", title: "Two", content: "Second note." },
      { kind: "doc", title: "Three", content: "Third note." },
    ]);
    expect(await queueDepth()).toBe(start + 3);

    await setColumns(first!, { content: "First note, edited." });
    expect(await queueDepth()).toBe(start + 4);
    await setColumns(second!, { title: "Two, renamed" });
    expect(await queueDepth()).toBe(start + 5);

    await setEmbedding(third!, axis(40));
    await setColumns(third!, { status: "retired", department: "ops", provenance: { source: "test" } });
    expect(await queueDepth()).toBe(start + 5);
  });

  it("memory_embedding_input is the title, a newline and the content, for the service role only", async () => {
    const { owner, companyId } = await freshCompany("hybrid-input");
    const [id] = await seed(companyId, [{ kind: "doc", title: "A title", content: "Some content." }]);

    const viaService = await raw.from("memory_items").select("id, input:memory_embedding_input").eq("id", id!).single();
    expect(viaService.data).toEqual({ id, input: "A title\nSome content." });

    const viaOwner = await (owner.client as unknown as typeof raw).from("memory_items").select("id, input:memory_embedding_input").eq("id", id!);
    expect(viaOwner.error?.code).toBe("42501");
  });

  it("a job that was read stays on the queue until it is acknowledged, and comes back after the visibility timeout", async () => {
    const { companyId } = await freshCompany("hybrid-ack");
    await drainQueue();
    const start = await queueDepth();
    const [id] = await seed(companyId, [{ kind: "doc", title: "Ack me", content: "Waiting for an embedding." }]);
    expect(await queueDepth()).toBe(start + 1);

    const [first, ...others] = await claimBatches();
    expect(others).toEqual([]);
    expect(first).toMatchObject({ ids: [id], schema: "public", table: "memory_items", contentFunction: "memory_embedding_input", embeddingColumn: "embedding" });
    const msgIds = first!.msgIds;
    expect(msgIds).toHaveLength(1);
    expect(await queueDepth()).toBe(start + 1);
    expect(await claimBatches()).toEqual([]);

    await wait(VISIBILITY_WAIT_MS);
    const [again] = await claimBatches();
    expect(again?.msgIds).toEqual(msgIds);
    expect(await queueDepth()).toBe(start + 1);

    expect(await ackJobs(msgIds)).toBe(1);
    expect(await queueDepth()).toBe(start);
    await wait(VISIBILITY_WAIT_MS);
    expect(await claimBatches()).toEqual([]);
    expect(await ackJobs(msgIds)).toBe(0);
    expect(await ackJobs([])).toBe(0);
  });

  it("a job read more than five times is archived instead of sent again", async () => {
    const { companyId } = await freshCompany("hybrid-poison");
    await drainQueue();
    const start = await queueDepth();
    const [id] = await seed(companyId, [{ kind: "doc", title: "Poison", content: "An embedding that never succeeds." }]);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const bodies = await claimBatches();
      expect(bodies.flatMap((body) => body.ids)).toEqual([id]);
      expect(await queueDepth()).toBe(start + 1);
      await wait(VISIBILITY_WAIT_MS);
    }
    expect(await claimBatches()).toEqual([]);
    expect(await queueDepth()).toBe(start);
  }, 30_000);

  it("a row with two waiting jobs (an insert and an edit) is one entry per job, side by side, in one body", async () => {
    const { companyId } = await freshCompany("hybrid-twice");
    await drainQueue();
    const [id] = await seed(companyId, [{ kind: "doc", title: "Edited twice", content: "First text." }]);
    await setColumns(id!, { content: "Second text." });

    const [body, ...others] = await claimBatches();
    expect(others).toEqual([]);
    expect(body!.ids).toEqual([id, id]);
    expect(body!.msgIds).toHaveLength(2);
    expect(body!.msgIds[0]).toBeLessThan(body!.msgIds[1]!);
    expect(await ackJobs(body!.msgIds)).toBe(2);
  });

  it("a body carries at most the batch size of rows, and every job lands in exactly one body", async () => {
    const { companyId } = await freshCompany("hybrid-batches");
    await drainQueue();
    const created = await seed(
      companyId,
      Array.from({ length: 3 }, (_, i): MemoryDraft => ({ kind: "doc", title: `Batch ${i}`, content: `Batched note ${i}.` })),
    );

    const bodies = await claimBatches(2, 2);
    expect(bodies.map((body) => body.ids.length).sort()).toEqual([1, 2]);
    expect(bodies.flatMap((body) => body.ids).sort()).toEqual([...created].sort());
    expect(await ackJobs(bodies.flatMap((body) => body.msgIds))).toBe(3);
  });
});
