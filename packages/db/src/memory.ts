import { MEMORY_KINDS, MemoryDraftSchema, type MemoryDraft, type MemoryKind } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";
import { currentThesis, type ThesisRecord } from "./theses";

export interface MemoryHit {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly content: string;
  /** The staff department the item belongs to; null for company-wide memory. */
  readonly department: string | null;
  /** Higher is better: ts_rank for the full-text search, the fused RRF score for the hybrid one. */
  readonly rank: number;
}

export interface MemoryItemRecord {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly content: string;
  readonly createdByRole: string;
  readonly createdAt: string;
}

export const DEFAULT_SEARCH_LIMIT = 8;
/** Size of a `gte-small` embedding, the `memory_items.embedding` column and the `search_memory_hybrid` argument. */
export const EMBEDDING_DIMENSIONS = 384;
/** Cap on the digest every agent run receives inside `<company_memory>`; the cut is marked with `DIGEST_TRUNCATION_MARKER`. */
export const DEFAULT_DIGEST_CHARS = 8000;
export const DIGEST_TRUNCATION_MARKER = "\n…[memory digest truncated]";
const DIGEST_ITEM_LIMIT = 100;

const MemoryItemRowSchema = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_KINDS),
  title: z.string(),
  content: z.string(),
  created_by_role: z.string(),
  created_at: z.string(),
});
const MemoryHitRowSchema = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_KINDS),
  title: z.string(),
  content: z.string(),
  department: z.string().nullable(),
  rank: z.number(),
});
const SearchQuerySchema = z.string().trim().min(1).max(500);
const SearchLimitSchema = z.number().int().min(1).max(50);
/** Finite numbers only (zod rejects NaN and Infinity), exactly one per embedding dimension. */
const EmbeddingSchema = z.array(z.number()).length(EMBEDDING_DIMENSIONS);

/** Persists memory drafts produced by an agent run; returns the new ids in input order. */
export async function writeMemoryItems(
  db: DbClient,
  companyId: string,
  items: readonly MemoryDraft[],
  createdByRole: string,
): Promise<readonly string[]> {
  const id = UuidSchema.parse(companyId);
  const drafts = z.array(MemoryDraftSchema).parse(items);
  const role = z.string().trim().min(1).max(60).parse(createdByRole);
  if (drafts.length === 0) return Object.freeze([]);
  const rows = drafts.map((d) => ({ company_id: id, kind: d.kind, title: d.title, content: d.content, created_by_role: role }));
  const { data, error } = await db.from("memory_items").insert(rows).select("id");
  if (error || !data) throw dbError("Could not write memory items", error);
  return Object.freeze(data.map((row) => row.id));
}

function parseSearchArgs(companyId: string, query: string, limit: number): { readonly id: string; readonly q: string; readonly n: number } {
  return { id: UuidSchema.parse(companyId), q: SearchQuerySchema.parse(query), n: SearchLimitSchema.parse(limit) };
}

function parseHits(rows: readonly unknown[] | null): readonly MemoryHit[] {
  return Object.freeze((rows ?? []).map((row) => Object.freeze(MemoryHitRowSchema.parse(row))));
}

/** Ranked full-text search (title + content) through the `search_memory` SQL function; active, unexpired items only. */
export async function searchMemory(db: DbClient, companyId: string, query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<readonly MemoryHit[]> {
  const { id, q, n } = parseSearchArgs(companyId, query, limit);
  const { data, error } = await db.rpc("search_memory", { p_company_id: id, p_query: q, p_limit: n });
  if (error) throw dbError("Could not search memory", error);
  return parseHits(data);
}

/**
 * Hybrid search (LRN-7): Reciprocal Rank Fusion of the full-text rank and the cosine rank of `embedding`
 * through `search_memory_hybrid`. A null `embedding` (no embedder reachable) is the full-text `searchMemory`,
 * so a caller never has to know whether the Edge Function is up.
 */
export async function searchMemoryHybrid(
  db: DbClient,
  companyId: string,
  query: string,
  embedding: readonly number[] | null,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<readonly MemoryHit[]> {
  if (embedding === null) return searchMemory(db, companyId, query, limit);
  const { id, q, n } = parseSearchArgs(companyId, query, limit);
  const vector = EmbeddingSchema.parse(embedding);
  const { data, error } = await db.rpc("search_memory_hybrid", { p_company_id: id, p_query: q, p_embedding: JSON.stringify(vector), p_limit: n });
  if (error) throw dbError("Could not search memory", error);
  return parseHits(data);
}

/** Newest active, unexpired memory items of the company (default 100), used by the digest and the worker services. */
export async function listMemoryItems(db: DbClient, companyId: string, limit: number = DIGEST_ITEM_LIMIT): Promise<readonly MemoryItemRecord[]> {
  const id = UuidSchema.parse(companyId);
  const n = z.number().int().min(1).max(500).parse(limit);
  const { data, error } = await db
    .from("memory_items")
    .select("id, kind, title, content, created_by_role, created_at")
    .eq("company_id", id)
    .eq("status", "active")
    // PostgREST reserves "." and ":" inside or= values, so the timestamp is double-quoted.
    .or(`valid_until.is.null,valid_until.gt."${new Date().toISOString()}"`)
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) throw dbError("Could not list memory items", error);
  return Object.freeze(
    (data ?? []).map((row) => {
      const r = MemoryItemRowSchema.parse(row);
      return Object.freeze({ id: r.id, kind: r.kind, title: r.title, content: r.content, createdByRole: r.created_by_role, createdAt: r.created_at });
    }),
  );
}

function thesisSection(thesis: ThesisRecord | null): string {
  if (!thesis) return "# Thesis\n(no thesis yet)";
  const lines = [
    `# Thesis (v${thesis.version})`,
    thesis.text,
    thesis.targetCustomer ? `Target customer: ${thesis.targetCustomer}` : "",
    thesis.whyNow ? `Why now: ${thesis.whyNow}` : "",
  ];
  const qa = thesis.clarifications.flatMap((c) => [`Q: ${c.question}`, `A: ${c.answer}`]);
  const clarifications = qa.length > 0 ? ["", "## Clarifications", ...qa] : [];
  return [...lines, ...clarifications].filter((line) => line.length > 0).join("\n");
}

function kindSection(kind: MemoryKind, items: readonly MemoryItemRecord[]): string {
  if (items.length === 0) return "";
  const entries = items.map((item) => `### ${item.title}\n${item.content}`);
  return [`## Memory: ${kind}`, ...entries].join("\n");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - DIGEST_TRUNCATION_MARKER.length)) + DIGEST_TRUNCATION_MARKER;
}

/** Pure formatter behind `memoryDigest`: thesis first, then newest items grouped by kind. */
export function formatMemoryDigest(thesis: ThesisRecord | null, items: readonly MemoryItemRecord[], maxChars: number): string {
  const sections = [thesisSection(thesis), ...MEMORY_KINDS.map((kind) => kindSection(kind, items.filter((i) => i.kind === kind)))];
  return truncate(sections.filter((s) => s.length > 0).join("\n\n"), maxChars);
}

/** Context block every agent run receives: current thesis plus the company's memory, capped at `maxChars`. */
export async function memoryDigest(db: DbClient, companyId: string, maxChars: number = DEFAULT_DIGEST_CHARS): Promise<string> {
  const id = UuidSchema.parse(companyId);
  const cap = z.number().int().min(DIGEST_TRUNCATION_MARKER.length).parse(maxChars);
  const [thesis, items] = await Promise.all([currentThesis(db, id), listMemoryItems(db, id, DIGEST_ITEM_LIMIT)]);
  return formatMemoryDigest(thesis, items, cap);
}
