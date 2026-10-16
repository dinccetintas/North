/**
 * Edge Function `embed` (LRN-7): memory embeddings inside Supabase.
 *
 * Two POST bodies, both requiring a service-role key (the platform checks the
 * JWT because `verify_jwt = true`; this function then requires the
 * `service_role` claim, since the anon key is a valid JWT too):
 *
 *   { ids, schema, table, contentFunction, embeddingColumn }
 *       A batch from the `embedding_jobs` queue, sent by
 *       util.process_embeddings() through pg_net. Each row's text is the
 *       output of `contentFunction` (a PostgREST computed column such as
 *       memory_embedding_input), embedded with gte-small and written to
 *       `embeddingColumn`. Answers { completed, skipped, failed }.
 *   { text }
 *       A query to embed for search_memory_hybrid. Answers { embedding }.
 *
 * Anything else is a 400. This is Deno code: it is not part of the package's
 * TypeScript project and it cannot run without the Supabase edge runtime
 * (`npx supabase functions serve embed`).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@4.6.7";

const MODEL = "gte-small";
const DIMENSIONS = 384;
const MAX_TEXT_CHARS = 8000;
const MAX_IDS = 50;

const IdentifierSchema = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);
const IdSchema = z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]);
const JobSchema = z.strictObject({
  ids: z.array(IdSchema).min(1).max(MAX_IDS),
  schema: IdentifierSchema,
  table: IdentifierSchema,
  contentFunction: IdentifierSchema,
  embeddingColumn: IdentifierSchema,
});
const QuerySchema = z.strictObject({ text: z.string().trim().min(1).max(MAX_TEXT_CHARS) });
const RowSchema = z.object({ id: IdSchema, content: z.string().nullable() });
const ClaimsSchema = z.object({ role: z.string() });

type Job = z.infer<typeof JobSchema>;
type RowId = z.infer<typeof IdSchema>;
interface Outcome {
  readonly completed: readonly RowId[];
  readonly skipped: readonly RowId[];
  readonly failed: readonly { readonly id: RowId; readonly error: string }[];
}

const session = new Supabase.ai.Session(MODEL);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The `role` claim of the bearer token. The platform has already verified the signature. */
function callerRole(req: Request): string | null {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "")?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = ClaimsSchema.safeParse(JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))));
    return claims.success ? claims.data.role : null;
  } catch {
    return null;
  }
}

/** One normalised, mean-pooled gte-small vector of exactly 384 finite numbers. */
async function embedText(text: string): Promise<number[]> {
  const output = await session.run(text.slice(0, MAX_TEXT_CHARS), { mean_pool: true, normalize: true });
  const vector = Array.from(output as ArrayLike<number>);
  if (vector.length !== DIMENSIONS || !vector.every(Number.isFinite)) throw new Error(`${MODEL} returned an invalid embedding`);
  return vector;
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Embeds the rows of one job, one by one; a failing row never stops the others. */
async function embedRows(db: SupabaseClient, job: Job): Promise<Outcome> {
  const table = () => db.schema(job.schema).from(job.table);
  const ids = [...new Set(job.ids)];
  const { data, error } = await table().select(`id, content:${job.contentFunction}`).in("id", ids);
  if (error) throw new Error(`Could not read ${job.table}: ${error.message}`);

  const completed: RowId[] = [];
  const skipped: RowId[] = [];
  const failed: { id: RowId; error: string }[] = [];
  const found = new Set<string>();
  for (const raw of data ?? []) {
    const row = RowSchema.safeParse(raw);
    if (!row.success) continue;
    found.add(String(row.data.id));
    if (!row.data.content?.trim()) {
      skipped.push(row.data.id);
      continue;
    }
    try {
      const vector = await embedText(row.data.content);
      const { error: writeError } = await table().update({ [job.embeddingColumn]: JSON.stringify(vector) }).eq("id", row.data.id);
      if (writeError) throw new Error(writeError.message);
      completed.push(row.data.id);
    } catch (err) {
      failed.push({ id: row.data.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  skipped.push(...ids.filter((id) => !found.has(String(id))));
  return { completed, skipped, failed };
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (callerRole(req) !== "service_role") return json({ error: "a service role key is required" }, 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "the body must be JSON" }, 400);
  }
  const query = QuerySchema.safeParse(body);
  if (query.success) return json({ embedding: await embedText(query.data.text) });
  const job = JobSchema.safeParse(body);
  if (job.success) return json(await embedRows(serviceClient(), job.data));
  return json({ error: "expected { text } or { ids, schema, table, contentFunction, embeddingColumn }" }, 400);
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (err) {
    console.error("embed failed", err);
    return json({ error: "embedding failed" }, 500);
  }
});
