import { BriefSchema, DAY_SCHEMA, type Brief } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { toJson, UuidSchema } from "./json";

/**
 * BRF-1: the morning brief is one `briefs` row per company and owner-local
 * day. The worker writes it (service role), owners read it; `content` is the
 * core `Brief` and is validated on both sides of the boundary.
 */
export interface BriefRecord {
  readonly id: string;
  readonly companyId: string;
  /** The owner-local day the brief is for (`YYYY-MM-DD`). */
  readonly day: string;
  readonly content: Brief;
  readonly wordCount: number;
  readonly createdAt: string;
}

export const CreateBriefInputSchema = z.object({
  companyId: UuidSchema,
  day: DAY_SCHEMA,
  content: BriefSchema,
  wordCount: z.number().int().nonnegative(),
});
export type CreateBriefInput = z.input<typeof CreateBriefInputSchema>;

const BRIEF_COLUMNS = "id, company_id, brief_date, content, word_count, created_at";

const BriefRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  brief_date: z.string(),
  content: BriefSchema,
  word_count: z.number().int(),
  created_at: z.string(),
});

/** Maps a raw row to the immutable `BriefRecord`; throws when the stored content is not a `Brief`. */
export function toBriefRecord(row: unknown): BriefRecord {
  const r = BriefRowSchema.parse(row);
  return Object.freeze({ id: r.id, companyId: r.company_id, day: r.brief_date, content: Object.freeze(r.content), wordCount: r.word_count, createdAt: r.created_at });
}

/** The brief of one company and day, or null when none was generated (or none is visible under RLS). */
export async function getBrief(db: DbClient, companyId: string, day: string): Promise<BriefRecord | null> {
  const id = UuidSchema.parse(companyId);
  const date = DAY_SCHEMA.parse(day);
  const { data, error } = await db.from("briefs").select(BRIEF_COLUMNS).eq("company_id", id).eq("brief_date", date).maybeSingle();
  if (error) throw dbError("Could not load brief", error);
  return data ? toBriefRecord(data) : null;
}

/**
 * Stores the day's brief (worker only). Idempotent on `(company_id, brief_date)`:
 * a second call for the same day returns the row that already exists, untouched.
 */
export async function createBrief(db: DbClient, input: CreateBriefInput): Promise<BriefRecord> {
  const b = CreateBriefInputSchema.parse(input);
  const { data, error } = await db
    .from("briefs")
    .insert({ company_id: b.companyId, brief_date: b.day, content: toJson(b.content), word_count: b.wordCount })
    .select(BRIEF_COLUMNS)
    .single();
  if (error?.code === "23505") {
    const existing = await getBrief(db, b.companyId, b.day);
    if (existing) return existing;
  }
  if (error || !data) throw dbError("Could not create brief", error);
  return toBriefRecord(data);
}

/** The newest brief of the company by day, or null. */
export async function latestBrief(db: DbClient, companyId: string): Promise<BriefRecord | null> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("briefs").select(BRIEF_COLUMNS).eq("company_id", id).order("brief_date", { ascending: false }).limit(1).maybeSingle();
  if (error) throw dbError("Could not load latest brief", error);
  return data ? toBriefRecord(data) : null;
}

/** Briefs of the company, newest day first, up to `limit`. */
export async function listBriefs(db: DbClient, companyId: string, limit = 30): Promise<readonly BriefRecord[]> {
  const id = UuidSchema.parse(companyId);
  const max = z.number().int().positive().max(366).parse(limit);
  const { data, error } = await db.from("briefs").select(BRIEF_COLUMNS).eq("company_id", id).order("brief_date", { ascending: false }).limit(max);
  if (error) throw dbError("Could not list briefs", error);
  return Object.freeze((data ?? []).map(toBriefRecord));
}

/**
 * MULTI-1: every brief of one owner-local day the caller can read, ordered by
 * company. With the owner's client that is exactly the owner's companies
 * (RLS); the portfolio brief is composed from these rows and nothing else.
 */
export async function listBriefsForDay(db: DbClient, day: string): Promise<readonly BriefRecord[]> {
  const date = DAY_SCHEMA.parse(day);
  const { data, error } = await db.from("briefs").select(BRIEF_COLUMNS).eq("brief_date", date).order("company_id", { ascending: true }).limit(500);
  if (error) throw dbError("Could not list the day's briefs", error);
  return Object.freeze((data ?? []).map(toBriefRecord));
}
