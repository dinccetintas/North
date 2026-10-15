import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";
import { LeadInputSchema, MAX_LEADS_PER_IMPORT, type LeadInput } from "./leads-csv";

export const LEAD_SOURCES = ["upload", "research"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ["new", "contacted", "replied", "bounced", "opted_out"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string;
  readonly companyName: string;
  readonly why: string;
  readonly source: LeadSource;
  readonly status: LeadStatus;
  readonly batchId: string | null;
  readonly messageId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ImportLeadsResult {
  readonly imported: number;
  /** Rows whose email already existed (in the table or earlier in the same batch). */
  readonly skipped: number;
}

export interface MarkLeadsOptions {
  readonly batchId?: string;
  readonly messageId?: string;
}

export interface ListLeadsOptions {
  readonly status?: readonly LeadStatus[];
  readonly limit?: number;
}

const LEAD_COLUMNS = "id, company_id, name, email, company_name, why, source, status, batch_id, message_id, created_at, updated_at";
const LeadRowsSchema = z.array(LeadInputSchema).max(MAX_LEADS_PER_IMPORT);

const LeadRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  name: z.string(),
  email: z.string(),
  company_name: z.string(),
  why: z.string(),
  source: z.enum(LEAD_SOURCES),
  status: z.enum(LEAD_STATUSES),
  batch_id: z.string().nullable(),
  message_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const toRecord = (row: unknown): LeadRecord => {
  const r = LeadRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    email: r.email,
    companyName: r.company_name,
    why: r.why,
    source: r.source,
    status: r.status,
    batchId: r.batch_id,
    messageId: r.message_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
};

/**
 * Inserts leads (≤ 500) for the company; an email already present (in the
 * table or earlier in the batch) is skipped, never overwritten: a lead's
 * status is history. Owners import `upload` rows under RLS; the worker
 * imports `research` rows. Returns how many landed and how many were skipped.
 */
export async function importLeads(db: DbClient, companyId: string, rows: readonly LeadInput[], source: LeadSource): Promise<ImportLeadsResult> {
  const id = UuidSchema.parse(companyId);
  const src = z.enum(LEAD_SOURCES).parse(source);
  const leads = LeadRowsSchema.parse(rows);
  const seen = new Set<string>();
  const unique = leads.filter((l) => !seen.has(l.email) && seen.add(l.email));
  if (unique.length === 0) return Object.freeze({ imported: 0, skipped: leads.length });
  const { data, error } = await db
    .from("leads")
    .upsert(
      unique.map((l) => ({ company_id: id, name: l.name, email: l.email, company_name: l.company, why: l.why, source: src })),
      { onConflict: "company_id,email", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw dbError("Could not import leads", error);
  const imported = data?.length ?? 0;
  return Object.freeze({ imported, skipped: leads.length - imported });
}

/** The oldest `new` leads, up to `limit` (what an outreach batch receives). */
export async function nextUnsentLeads(db: DbClient, companyId: string, limit = 5): Promise<readonly LeadRecord[]> {
  return listLeads(db, companyId, { status: ["new"], limit });
}

/** Leads of the company, oldest first, optionally filtered by status. */
export async function listLeads(db: DbClient, companyId: string, opts: ListLeadsOptions = {}): Promise<readonly LeadRecord[]> {
  const id = UuidSchema.parse(companyId);
  const limit = z.number().int().positive().max(1000).default(500).parse(opts.limit);
  const base = db.from("leads").select(LEAD_COLUMNS).eq("company_id", id);
  const filtered = opts.status && opts.status.length > 0 ? base.in("status", z.array(z.enum(LEAD_STATUSES)).parse(opts.status)) : base;
  const { data, error } = await filtered.order("created_at", { ascending: true }).order("email", { ascending: true }).limit(limit);
  if (error) throw dbError("Could not list leads", error);
  return Object.freeze((data ?? []).map(toRecord));
}

/** One lead of the company by id, or null when it does not exist, belongs to another company or is not visible under RLS. */
export async function getLead(db: DbClient, companyId: string, leadId: string): Promise<LeadRecord | null> {
  const company = UuidSchema.parse(companyId);
  const id = UuidSchema.parse(leadId);
  const { data, error } = await db.from("leads").select(LEAD_COLUMNS).eq("company_id", company).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load lead", error);
  return data ? toRecord(data) : null;
}

/**
 * Worker only: moves the given leads of the company to a status, optionally
 * stamping the batch and message that contacted them. Scoped by company (M4
 * review H3/M3): ids of another company change nothing. Returns how many rows changed.
 */
export async function markLeads(db: DbClient, companyId: string, leadIds: readonly string[], status: LeadStatus, opts: MarkLeadsOptions = {}): Promise<number> {
  const company = UuidSchema.parse(companyId);
  const ids = z.array(UuidSchema).max(MAX_LEADS_PER_IMPORT).parse(leadIds);
  const next = z.enum(LEAD_STATUSES).parse(status);
  if (ids.length === 0) return 0;
  const patch = {
    status: next,
    ...(opts.batchId === undefined ? {} : { batch_id: z.string().min(1).max(64).parse(opts.batchId) }),
    ...(opts.messageId === undefined ? {} : { message_id: z.string().min(1).max(500).parse(opts.messageId) }),
  };
  const { data, error } = await db.from("leads").update(patch).eq("company_id", company).in("id", ids).select("id");
  if (error) throw dbError("Could not mark leads", error);
  return data?.length ?? 0;
}

/** How many leads the company has, optionally in the given statuses (the Team page's "Leads" count). */
export async function countLeads(db: DbClient, companyId: string, opts: Pick<ListLeadsOptions, "status"> = {}): Promise<number> {
  const id = UuidSchema.parse(companyId);
  const base = db.from("leads").select("id", { count: "exact", head: true }).eq("company_id", id);
  const filtered = opts.status && opts.status.length > 0 ? base.in("status", z.array(z.enum(LEAD_STATUSES)).parse(opts.status)) : base;
  const { count, error } = await filtered;
  if (error) throw dbError("Could not count leads", error);
  return count ?? 0;
}
