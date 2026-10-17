import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@north/db";
import { edgeFunctionEmbedder, nullEmbedder, QUERY_MAX_CHARS } from "../src/services/embedder";

/**
 * LRN-7 / SEC-1: the query embedder behind hybrid memory search. It asks the
 * `embed` Edge Function for one vector with the service key, and answers null
 * on any failure (wrong length, an error status, a timeout, no network), so a
 * search falls back to full text and never fails because of it.
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = "service-role-key-for-tests";
const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fetch that records each call and answers with `respond`. */
function fakeFetch(respond: () => Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(input), init: init ?? {} });
    return respond();
  };
  return { fetchImpl: fetchImpl as typeof fetch, seen };
}

const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("LRN-7 edgeFunctionEmbedder", () => {
  it("SEC-1 posts { text } to <supabaseUrl>/functions/v1/embed with the service key and returns the 384-number vector", async () => {
    const fake = fakeFetch(answer({ embedding: vector }));
    const embedder = edgeFunctionEmbedder({ supabaseUrl: `${SUPABASE_URL}/`, serviceRoleKey: SERVICE_KEY, fetchImpl: fake.fetchImpl });
    expect(await embedder.embed("bookkeeping for consultants")).toEqual(vector);
    expect(fake.seen).toHaveLength(1);
    const [{ url, init }] = fake.seen as [Seen];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/embed`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ text: "bookkeeping for consultants" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("LRN-7 answers null for a vector of the wrong length, a non-number, an error status, a body that is not JSON, or a fetch that throws", async () => {
    const cases: Array<() => Promise<Response>> = [
      answer({ embedding: vector.slice(1) }),
      answer({ embedding: [...vector.slice(1), "x"] }),
      answer({ vectors: vector }),
      answer({ error: "embedding failed" }, 500),
      answer({ embedding: vector }, 500),
      async () => new Response("<html>bad gateway</html>", { status: 200 }),
      async () => Promise.reject(new TypeError("fetch failed")),
    ];
    for (const respond of cases) {
      const embedder = edgeFunctionEmbedder({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_KEY, fetchImpl: fakeFetch(respond).fetchImpl });
      expect(await embedder.embed("query")).toBeNull();
    }
  });

  it("LRN-7 answers null when the function does not answer within the timeout, even from a fetch that ignores the abort signal", async () => {
    const never = fakeFetch(() => new Promise<Response>(() => undefined));
    const embedder = edgeFunctionEmbedder({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_KEY, fetchImpl: never.fetchImpl, timeoutMs: 20 });
    const started = Date.now();
    expect(await embedder.embed("query")).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("LRN-7 sends nothing for blank text, and cuts a long query to what the function accepts", async () => {
    const fake = fakeFetch(answer({ embedding: vector }));
    const embedder = edgeFunctionEmbedder({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_KEY, fetchImpl: fake.fetchImpl });
    expect(await embedder.embed("   ")).toBeNull();
    expect(fake.seen).toHaveLength(0);
    await embedder.embed("q".repeat(QUERY_MAX_CHARS + 500));
    expect((JSON.parse(String(fake.seen[0]?.init.body)) as { text: string }).text).toHaveLength(QUERY_MAX_CHARS);
  });

  it("SEC-1 a failure is reported through warn with its reason, never with the key", async () => {
    const warnings: string[] = [];
    const embedder = edgeFunctionEmbedder({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_KEY, fetchImpl: fakeFetch(answer({ error: "no" }, 503)).fetchImpl, warn: (m) => warnings.push(m) });
    expect(await embedder.embed("query")).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/503/);
    expect(warnings[0]).not.toContain(SERVICE_KEY);
  });

  it("LRN-7 nullEmbedder always answers null", async () => {
    expect(await nullEmbedder.embed("anything")).toBeNull();
  });
});
