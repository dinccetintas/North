import { SIGNAL_KINDS, SIGNAL_SOURCES, SIGNAL_STATUSES, SignalCandidateSchema, type SignalKind, type SignalSource, type SignalStatus } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { isJsonObject, toJson, UuidSchema } from "./json";

/** The weekly opportunity cap refused a card (PRO-3-CAP): the partial unique index `signals_opportunity_week_idx`. */
export class SignalCapError extends DbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "SignalCapError";
  }
}

/** One observation from a source; it becomes a card only through the gate (`signal.pursue`, ADR 0012). */
export interface SignalRecord {
  readonly id: string;
  readonly companyId: string;
  readonly kind: SignalKind;
  readonly source: SignalSource;
  /** Unique per company and source: a rescan never re-inserts a post. */
  readonly sourceRef: string;
  readonly title: string;
  readonly url: string | null;
  readonly excerpt: string;
  readonly summary: string;
  readonly rationale: string;
  readonly score: number;
  readonly status: SignalStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  /** `YYYY-Www` of the owner-local day the card opened; the weekly cap keys on it. */
  readonly cardWeek: string | null;
  readonly convertedCardId: string | null;
  readonly convertedTaskId: string | null;
  readonly observedAt: string;
  readonly scoredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const WeekSchema = z.string().regex(/^\d{4}-W\d{2}$/, "YYYY-Www");
const ScoreSchema = z.number().min(0).max(1);

export const InsertSignalsOptionsSchema = z.object({
  kind: z.enum(SIGNAL_KINDS),
  score: ScoreSchema.default(0),
  status: z.enum(SIGNAL_STATUSES).default("new"),
});
export type InsertSignalsOptions = z.input<typeof InsertSignalsOptionsSchema>;

export const SignalPatchSchema = z
  .object({
    status: z.enum(SIGNAL_STATUSES).optional(),
    score: ScoreSchema.optional(),
    summary: z.string().max(200).optional(),
    rationale: z.string().max(300).optional(),
    convertedCardId: UuidSchema.nullable().optional(),
    convertedTaskId: UuidSchema.nullable().optional(),
    cardWeek: WeekSchema.nullable().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: "nothing to update" });
export type SignalPatch = z.input<typeof SignalPatchSchema>;

export interface ListSignalsOptions {
  readonly status?: readonly SignalStatus[];
  readonly kind?: readonly SignalKind[];
  /** Only rows created in the last N days. */
  readonly sinceDays?: number;
  readonly cardWeek?: string;
  readonly limit?: number;
}

const MAX_CANDIDATES = 100;
const SIGNAL_COLUMNS =
  "id, company_id, kind, source, source_ref, title, url, excerpt, summary, rationale, score, status, payload, card_week, converted_card_id, converted_task_id, observed_at, scored_at, created_at, updated_at";

const SignalRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  kind: z.enum(SIGNAL_KINDS),
  source: z.enum(SIGNAL_SOURCES),
  source_ref: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  excerpt: z.string(),
  summary: z.string(),
  rationale: z.string(),
  score: z.coerce.number(),
  status: z.enum(SIGNAL_STATUSES),
  payload: z.unknown(),
  card_week: z.string().nullable(),
  converted_card_id: z.string().nullable(),
  converted_task_id: z.string().nullable(),
  observed_at: z.string(),
  scored_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Maps a raw row to the immutable `SignalRecord`; throws when the row is malformed. */
export function toSignalRecord(row: unknown): SignalRecord {
  const r = SignalRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    kind: r.kind,
    source: r.source,
    sourceRef: r.source_ref,
    title: r.title,
    url: r.url,
    excerpt: r.excerpt,
    summary: r.summary,
    rationale: r.rationale,
    score: r.score,
    status: r.status,
    payload: Object.freeze(isJsonObject(r.payload) ? { ...r.payload } : {}),
    cardWeek: r.card_week,
    convertedCardId: r.converted_card_id,
    convertedTaskId: r.converted_task_id,
    observedAt: r.observed_at,
    scoredAt: r.scored_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

const isCapViolation = (error: { code?: string; message?: string } | null): boolean =>
  Boolean(error && error.code === "23505" && /signals_opportunity_week_idx/.test(error.message ?? ""));

/** A candidate with an optional structured payload (the sanitised Sentry issue) written in the same insert (M5 review L4). */
export const InsertSignalCandidateSchema = SignalCandidateSchema.extend({ payload: z.record(z.string(), z.unknown()).optional() });
export type InsertSignalCandidate = z.input<typeof InsertSignalCandidateSchema>;

const candidateRow = (companyId: string, c: z.output<typeof InsertSignalCandidateSchema>, o: z.output<typeof InsertSignalsOptionsSchema>) => ({
  company_id: companyId,
  kind: o.kind,
  source: c.source,
  source_ref: c.sourceRef,
  title: c.title,
  url: c.url,
  excerpt: c.excerpt,
  score: o.score,
  status: c.baseline ? ("below_threshold" as const) : o.status,
  observed_at: c.observedAt,
  ...(c.payload === undefined ? {} : { payload: toJson(c.payload) }),
});

/**
 * Inserts the candidates a scan produced (worker only) and returns the ids of
 * the rows that were new. A candidate whose `(company, source, sourceRef)`
 * already exists is ignored, so a rescan never duplicates a post. A
 * `baseline` candidate lands `below_threshold` and is never scored. A
 * candidate's `payload`, when given, lands in the same row write.
 */
export async function insertSignals(db: DbClient, companyId: string, candidates: readonly InsertSignalCandidate[], options: InsertSignalsOptions): Promise<readonly string[]> {
  const id = UuidSchema.parse(companyId);
  const list = z.array(InsertSignalCandidateSchema).max(MAX_CANDIDATES).parse(candidates);
  const o = InsertSignalsOptionsSchema.parse(options);
  if (list.length === 0) return Object.freeze([]);
  const rows = list.map((c) => candidateRow(id, c, o));
  const { data, error } = await db.from("signals").upsert(rows, { onConflict: "company_id,source,source_ref", ignoreDuplicates: true }).select("id");
  if (error) throw dbError("Could not insert signals", error);
  return Object.freeze((data ?? []).map((r) => r.id));
}

/** Signals of the company, newest first, filtered by status, kind, week and age. */
export async function listSignals(db: DbClient, companyId: string, opts: ListSignalsOptions = {}): Promise<readonly SignalRecord[]> {
  const id = UuidSchema.parse(companyId);
  const limit = z.number().int().positive().max(500).default(50).parse(opts.limit);
  const sinceDays = z.number().positive().max(3650).optional().parse(opts.sinceDays);
  const statuses = z.array(z.enum(SIGNAL_STATUSES)).optional().parse(opts.status);
  const kinds = z.array(z.enum(SIGNAL_KINDS)).optional().parse(opts.kind);
  const week = WeekSchema.optional().parse(opts.cardWeek);
  const base = db.from("signals").select(SIGNAL_COLUMNS).eq("company_id", id);
  const byStatus = statuses && statuses.length > 0 ? base.in("status", statuses) : base;
  const byKind = kinds && kinds.length > 0 ? byStatus.in("kind", kinds) : byStatus;
  const byWeek = week === undefined ? byKind : byKind.eq("card_week", week);
  const windowed = sinceDays === undefined ? byWeek : byWeek.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  const { data, error } = await windowed.order("created_at", { ascending: false }).limit(limit);
  if (error) throw dbError("Could not list signals", error);
  return Object.freeze((data ?? []).map(toSignalRecord));
}

/** One signal of the company by id, or null when it does not exist, belongs to another company or is invisible under RLS. */
export async function getSignal(db: DbClient, companyId: string, signalId: string): Promise<SignalRecord | null> {
  const company = UuidSchema.parse(companyId);
  const id = UuidSchema.parse(signalId);
  const { data, error } = await db.from("signals").select(SIGNAL_COLUMNS).eq("company_id", company).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load signal", error);
  return data ? toSignalRecord(data) : null;
}

/** The signal a source knows by this reference, or null. */
export async function signalByRef(db: DbClient, companyId: string, source: SignalSource, sourceRef: string): Promise<SignalRecord | null> {
  const company = UuidSchema.parse(companyId);
  const src = z.enum(SIGNAL_SOURCES).parse(source);
  const ref = z.string().min(1).max(200).parse(sourceRef);
  const { data, error } = await db.from("signals").select(SIGNAL_COLUMNS).eq("company_id", company).eq("source", src).eq("source_ref", ref).maybeSingle();
  if (error) throw dbError("Could not load signal by reference", error);
  return data ? toSignalRecord(data) : null;
}

/** Source references already stored for one source (newest first, up to `limit`): what a scan hands its adapter as `knownRefs`. */
export async function knownSourceRefs(db: DbClient, companyId: string, source: SignalSource, limit = 500): Promise<readonly string[]> {
  const company = UuidSchema.parse(companyId);
  const src = z.enum(SIGNAL_SOURCES).parse(source);
  const max = z.number().int().positive().max(5000).parse(limit);
  const { data, error } = await db.from("signals").select("source_ref").eq("company_id", company).eq("source", src).order("created_at", { ascending: false }).limit(max);
  if (error) throw dbError("Could not list known source references", error);
  return Object.freeze((data ?? []).map((r) => r.source_ref));
}

const patchColumns = (p: z.output<typeof SignalPatchSchema>) => ({
  ...(p.status === undefined ? {} : { status: p.status }),
  ...(p.score === undefined ? {} : { score: p.score, scored_at: new Date().toISOString() }),
  ...(p.summary === undefined ? {} : { summary: p.summary }),
  ...(p.rationale === undefined ? {} : { rationale: p.rationale }),
  ...(p.convertedCardId === undefined ? {} : { converted_card_id: p.convertedCardId }),
  ...(p.convertedTaskId === undefined ? {} : { converted_task_id: p.convertedTaskId }),
  ...(p.cardWeek === undefined ? {} : { card_week: p.cardWeek }),
});

/**
 * Patches one signal of the company (worker only): status, score (stamps
 * `scored_at`), summary, rationale, the converted card/task and the card
 * week. Setting the week of a second `opportunity` card in the same week is
 * refused by the database and surfaces as `SignalCapError` (PRO-3-CAP).
 */
export async function updateSignal(db: DbClient, companyId: string, signalId: string, patch: SignalPatch): Promise<SignalRecord> {
  const company = UuidSchema.parse(companyId);
  const id = UuidSchema.parse(signalId);
  const p = SignalPatchSchema.parse(patch);
  const { data, error } = await db.from("signals").update(patchColumns(p)).eq("company_id", company).eq("id", id).select(SIGNAL_COLUMNS).maybeSingle();
  if (isCapViolation(error)) throw new SignalCapError(`The week ${p.cardWeek} already has its opportunity card for company ${company}`, error);
  if (error) throw dbError("Could not update signal", error);
  if (!data) throw new DbError(`Signal ${id} not found in company ${company} or not writable`);
  return toSignalRecord(data);
}

/** Stores a structured payload on a signal (the sanitised Sentry issue, a metric drop's numbers); worker only. */
export async function setSignalPayload(db: DbClient, companyId: string, signalId: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
  const company = UuidSchema.parse(companyId);
  const id = UuidSchema.parse(signalId);
  const { error } = await db.from("signals").update({ payload: toJson(payload) }).eq("company_id", company).eq("id", id);
  if (error) throw dbError("Could not store signal payload", error);
}
