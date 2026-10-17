// LRN-7: the query side of hybrid memory search. A memory query is embedded by
// the `embed` Edge Function (gte-small, inside Supabase) with the service key;
// any failure (an error status, a wrong vector, no answer within the timeout)
// is null, and `searchMemoryHybrid` then searches by words alone. The reply is
// untrusted and validated; the embedder never throws.
import { EMBEDDING_DIMENSIONS } from "@north/db";
import { z } from "zod";

/** Turns a memory query into a vector, or null when it cannot. */
export interface Embedder {
  embed(text: string): Promise<readonly number[] | null>;
}

/** The longest query the Edge Function accepts; a longer one is cut to it. */
export const QUERY_MAX_CHARS = 8000;
/** How long one embedding may take before the search goes ahead without it. */
export const EMBED_TIMEOUT_MS = 5000;

/** Options of `edgeFunctionEmbedder`. */
export interface EdgeFunctionEmbedderOptions {
  readonly supabaseUrl: string;
  /** Sent as the bearer token and `apikey`: the function requires the service role. */
  readonly serviceRoleKey: string;
  readonly fetchImpl?: typeof fetch;
  /** Defaults to `EMBED_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Told why an embedding failed (never the key); silent by default. */
  readonly warn?: (message: string) => void;
}

/** The reply's shape, built on first use (tests that replace `@north/db` with a fake can still load this module). */
let replySchema: z.ZodType<{ embedding: number[] }> | null = null;
const ReplySchema = (): z.ZodType<{ embedding: number[] }> => (replySchema ??= z.object({ embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS) }));

/** The embedder that never embeds: hybrid search becomes full-text search. */
export const nullEmbedder: Embedder = Object.freeze({ embed: async () => null });

/** Rejects once `signal` aborts, so a fetch that ignores its signal cannot hold the search. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = (): void => reject(new Error("the embed function did not answer in time"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

/** One call to the function: the validated, frozen vector, or a throw. */
async function requestEmbedding(url: string, opts: EdgeFunctionEmbedderOptions, text: string, signal: AbortSignal): Promise<readonly number[]> {
  const response = await (opts.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.serviceRoleKey}`, apikey: opts.serviceRoleKey, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) throw new Error(`the embed function answered ${response.status}`);
  const parsed = ReplySchema().safeParse(await response.json());
  if (!parsed.success) throw new Error(`the embed function answered something that is not a ${EMBEDDING_DIMENSIONS}-number embedding`);
  return Object.freeze(parsed.data.embedding);
}

/**
 * Embeds a query through `<supabaseUrl>/functions/v1/embed` (POST `{ text }`,
 * the service key as bearer token and `apikey`). Blank text is not sent; a
 * query over `QUERY_MAX_CHARS` is cut to it. Null on any failure, including a
 * reply that takes longer than the timeout (5 s by default).
 */
export function edgeFunctionEmbedder(opts: EdgeFunctionEmbedderOptions): Embedder {
  const url = `${opts.supabaseUrl.replace(/\/+$/, "")}/functions/v1/embed`;
  const timeoutMs = opts.timeoutMs ?? EMBED_TIMEOUT_MS;
  return Object.freeze({
    async embed(text: string): Promise<readonly number[] | null> {
      if (text.trim() === "") return null;
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        return await Promise.race([requestEmbedding(url, opts, text.slice(0, QUERY_MAX_CHARS), signal), untilAborted(signal)]);
      } catch (error) {
        opts.warn?.(`embedder: ${error instanceof Error ? error.message : "failed"}; memory search goes by words only`);
        return null;
      }
    },
  });
}
