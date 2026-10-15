import { CardDraftSchema, CardOptionSchema, DAY_SCHEMA, TIERS, type AnsweredCard, type CardDraft, type Tier } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { toJson, UuidSchema } from "./json";

/** The daily quota is enforced by the database trigger; this error surfaces that refusal (DEC-3). */
export class QuotaExceededError extends DbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "QuotaExceededError";
  }
}

/** A card accepts exactly one answer; a second attempt is refused (DEC-2). */
export class AlreadyAnsweredError extends DbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "AlreadyAnsweredError";
  }
}

export const ANSWERED_BY = ["user", "default", "auto_rule"] as const;
export type AnsweredBy = (typeof ANSWERED_BY)[number];

export interface CardOption {
  readonly id: string;
  readonly label: string;
}

export interface CardRecord {
  readonly id: string;
  readonly companyId: string;
  readonly taskId: string | null;
  readonly actionId: string | null;
  readonly actionKind: CardDraft["actionKind"];
  readonly tier: Tier;
  readonly question: string;
  readonly options: readonly CardOption[];
  readonly recommendedOptionId: string;
  readonly defaultOptionId: string | null;
  readonly rationale: string;
  readonly expectedImpact: string | null;
  readonly costUsd: number;
  readonly dueAt: string;
  /** When the card was opened (the worker's clock); `day` is derived from it in the owner's zone by the database (DEC-3). */
  readonly openedAt: string;
  /** The owner-local day the card counts against. */
  readonly day: string;
  readonly seq: number;
  readonly mergeKey: string;
  readonly answeredOptionId: string | null;
  readonly answeredAt: string | null;
  readonly answeredBy: AnsweredBy | null;
  readonly createdAt: string;
}

const hasOption = (options: readonly { id: string }[], id: string | null): boolean => id === null || options.some((o) => o.id === id);

/** A core `CardDraft` plus its links. Only K2/K3 open cards; K3 never carries a default (DEC-2). */
export const OpenCardInputSchema = CardDraftSchema.extend({
  companyId: UuidSchema,
  taskId: UuidSchema.nullable().default(null),
  actionId: UuidSchema.optional(),
  /** The worker's clock; defaults to the database's `now()`. The quota day is computed from it, never passed as a date. */
  openedAt: z.iso.datetime({ offset: true }).optional(),
})
  .refine((d) => d.tier === "K2" || d.tier === "K3", { message: "only K2 and K3 actions open cards", path: ["tier"] })
  .refine((d) => hasOption(d.options, d.recommendedOptionId), { message: "recommendedOptionId must be one of the options", path: ["recommendedOptionId"] })
  .refine((d) => hasOption(d.options, d.defaultOptionId), { message: "defaultOptionId must be one of the options", path: ["defaultOptionId"] })
  .refine((d) => d.tier !== "K3" || d.defaultOptionId === null, { message: "K3 cards have no default", path: ["defaultOptionId"] });
export type OpenCardInput = z.input<typeof OpenCardInputSchema>;

export const AnswerCardInputSchema = z.object({ optionId: z.string().min(1), answeredBy: z.enum(ANSWERED_BY) });
export type AnswerCardInput = z.input<typeof AnswerCardInputSchema>;

const CARD_COLUMNS =
  "id, company_id, task_id, action_id, action_kind, tier, question, options, recommended_option_id, default_option_id, rationale, expected_impact, cost_usd, due_at, opened_at, day, seq, merge_key, answered_option_id, answered_at, answered_by, created_at";

const CardRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  task_id: z.string().nullable(),
  action_id: z.string().nullable(),
  action_kind: CardDraftSchema.shape.actionKind,
  tier: z.enum(TIERS),
  question: z.string(),
  options: z.array(CardOptionSchema),
  recommended_option_id: z.string(),
  default_option_id: z.string().nullable(),
  rationale: z.string(),
  expected_impact: z.string().nullable(),
  cost_usd: z.coerce.number(),
  due_at: z.string(),
  opened_at: z.string(),
  day: z.string(),
  seq: z.number().int(),
  merge_key: z.string(),
  answered_option_id: z.string().nullable(),
  answered_at: z.string().nullable(),
  answered_by: z.enum(ANSWERED_BY).nullable(),
  created_at: z.string(),
});

/** Maps a raw row to the immutable `CardRecord`; throws when the row is malformed. */
export function toCardRecord(row: unknown): CardRecord {
  const r = CardRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    taskId: r.task_id,
    actionId: r.action_id,
    actionKind: r.action_kind,
    tier: r.tier,
    question: r.question,
    options: Object.freeze(r.options.map((o) => Object.freeze({ id: o.id, label: o.label }))),
    recommendedOptionId: r.recommended_option_id,
    defaultOptionId: r.default_option_id,
    rationale: r.rationale,
    expectedImpact: r.expected_impact,
    costUsd: r.cost_usd,
    dueAt: r.due_at,
    openedAt: r.opened_at,
    day: r.day,
    seq: r.seq,
    mergeKey: r.merge_key,
    answeredOptionId: r.answered_option_id,
    answeredAt: r.answered_at,
    answeredBy: r.answered_by,
    createdAt: r.created_at,
  });
}

const isQuotaError = (error: { code?: string; message?: string } | null): boolean =>
  Boolean(error && (error.code === "23514" || error.code === "P0001") && /decision quota/i.test(error.message ?? ""));

/**
 * Opens a decision card (DEC-1/2). The trigger assigns `seq` and refuses the
 * card when the owner's daily quota is spent, surfaced as `QuotaExceededError`
 * so the caller can defer the action instead of dropping it (DEC-3).
 */
export async function openCard(db: DbClient, input: OpenCardInput): Promise<CardRecord> {
  const d = OpenCardInputSchema.parse(input);
  const { data, error } = await db
    .from("decision_cards")
    .insert({
      company_id: d.companyId,
      task_id: d.taskId,
      action_id: d.actionId ?? null,
      action_kind: d.actionKind,
      tier: d.tier,
      question: d.question,
      options: toJson(d.options),
      recommended_option_id: d.recommendedOptionId,
      default_option_id: d.defaultOptionId,
      rationale: d.rationale,
      expected_impact: d.expectedImpact,
      cost_usd: d.costUsd,
      due_at: d.dueAt,
      merge_key: d.mergeKey,
      ...(d.openedAt === undefined ? {} : { opened_at: d.openedAt }),
    })
    .select(CARD_COLUMNS)
    .single();
  if (isQuotaError(error)) throw new QuotaExceededError(`Daily decision quota reached for company ${d.companyId}`, error);
  if (error || !data) throw dbError("Could not open decision card", error);
  return toCardRecord(data);
}

/** One card by id, or null when it does not exist or is not visible under RLS. */
export async function getCard(db: DbClient, cardId: string): Promise<CardRecord | null> {
  const id = UuidSchema.parse(cardId);
  const { data, error } = await db.from("decision_cards").select(CARD_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load decision card", error);
  return data ? toCardRecord(data) : null;
}

/** Unanswered cards, soonest due first, then by seq. This is what the morning screen shows. */
export async function listPendingCards(db: DbClient, companyId: string): Promise<readonly CardRecord[]> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db
    .from("decision_cards")
    .select(CARD_COLUMNS)
    .eq("company_id", id)
    .is("answered_at", null)
    .order("due_at", { ascending: true })
    .order("seq", { ascending: true });
  if (error) throw dbError("Could not list pending cards", error);
  return Object.freeze((data ?? []).map(toCardRecord));
}

export interface ListCardsOptions {
  readonly limit?: number;
}

/** Every card of the company, newest first. */
export async function listCards(db: DbClient, companyId: string, opts: ListCardsOptions = {}): Promise<readonly CardRecord[]> {
  const id = UuidSchema.parse(companyId);
  const limit = z.number().int().positive().max(500).default(50).parse(opts.limit);
  const { data, error } = await db
    .from("decision_cards")
    .select(CARD_COLUMNS)
    .eq("company_id", id)
    .order("created_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw dbError("Could not list cards", error);
  return Object.freeze((data ?? []).map(toCardRecord));
}

/** Answered cards of one action kind, newest answer first, in the shape `suggestAutoRule` reads (DEC-3). */
export async function listAnsweredCards(db: DbClient, companyId: string, actionKind: CardDraft["actionKind"], limit = 10): Promise<readonly AnsweredCard[]> {
  const id = UuidSchema.parse(companyId);
  const kind = CardDraftSchema.shape.actionKind.parse(actionKind);
  const max = z.number().int().positive().max(100).parse(limit);
  const { data, error } = await db
    .from("decision_cards")
    .select("action_kind, merge_key, answered_option_id, answered_at, cost_usd")
    .eq("company_id", id)
    .eq("action_kind", kind)
    .not("answered_at", "is", null)
    .order("answered_at", { ascending: false })
    .limit(max);
  if (error) throw dbError("Could not list answered cards", error);
  const rows = (data ?? []).flatMap((row) =>
    row.answered_option_id && row.answered_at
      ? [Object.freeze({ actionKind: kind, mergeKey: row.merge_key, answeredOptionId: row.answered_option_id, answeredAt: row.answered_at, costUsd: Number(row.cost_usd) })]
      : [],
  );
  return Object.freeze(rows);
}

function assertAnswerAllowed(card: CardRecord, answer: z.output<typeof AnswerCardInputSchema>): void {
  if (!card.options.some((o) => o.id === answer.optionId)) {
    throw new DbError(`Option ${answer.optionId} is not one of the card's options`);
  }
  if (answer.answeredBy === "default" && (card.tier === "K3" || card.defaultOptionId === null || card.defaultOptionId !== answer.optionId)) {
    throw new DbError(card.tier === "K3" ? "K3 cards have no default answer" : "A default answer must be the card's safe default");
  }
}

/**
 * Records the single answer to a card (DEC-2). Idempotency is strict: the second
 * answer throws `AlreadyAnsweredError` and the first one stands. A default
 * answer must equal the card's safe default and K3 never accepts one.
 */
export async function answerCard(db: DbClient, cardId: string, input: AnswerCardInput): Promise<CardRecord> {
  const id = UuidSchema.parse(cardId);
  const answer = AnswerCardInputSchema.parse(input);
  const card = await getCard(db, id);
  if (!card) throw new DbError(`Decision card ${id} not found`);
  if (card.answeredAt) throw new AlreadyAnsweredError(`Decision card ${id} was already answered (${card.answeredOptionId})`);
  assertAnswerAllowed(card, answer);

  const { data, error } = await db
    .from("decision_cards")
    .update({ answered_option_id: answer.optionId, answered_at: new Date().toISOString(), answered_by: answer.answeredBy })
    .eq("id", id)
    .is("answered_at", null)
    .select(CARD_COLUMNS)
    .maybeSingle();
  if (error) throw dbError("Could not answer decision card", error);
  if (!data) {
    const current = await getCard(db, id);
    if (current?.answeredAt) throw new AlreadyAnsweredError(`Decision card ${id} was answered concurrently (${current.answeredOptionId})`);
    throw new DbError(`Decision card ${id} could not be answered`);
  }
  return toCardRecord(data);
}

/** Unanswered cards of one task (a task parks until all of them are answered). */
export async function listPendingCardsForTask(db: DbClient, taskId: string): Promise<readonly CardRecord[]> {
  const id = UuidSchema.parse(taskId);
  const { data, error } = await db.from("decision_cards").select(CARD_COLUMNS).eq("task_id", id).is("answered_at", null).order("seq", { ascending: true });
  if (error) throw dbError("Could not list the task's cards", error);
  return Object.freeze((data ?? []).map(toCardRecord));
}

/** Unanswered cards past their deadline, oldest first (the deadline cron applies K2 defaults; K3 waits). */
export async function listOverdueCards(db: DbClient, now: Date = new Date(), limit = 100): Promise<readonly CardRecord[]> {
  const max = z.number().int().positive().max(1000).parse(limit);
  const { data, error } = await db
    .from("decision_cards")
    .select(CARD_COLUMNS)
    .is("answered_at", null)
    .lt("due_at", now.toISOString())
    .order("due_at", { ascending: true })
    .limit(max);
  if (error) throw dbError("Could not list overdue cards", error);
  return Object.freeze((data ?? []).map(toCardRecord));
}

/**
 * Cards opened for the company on one owner-local day (DEC-3). The caller
 * passes the day it means (`localDay(timezone, now)` from core), so the web
 * and the worker count "today" the same way the trigger does.
 */
export async function cardsOpenedToday(db: DbClient, companyId: string, day: string): Promise<number> {
  const id = UuidSchema.parse(companyId);
  const date = DAY_SCHEMA.parse(day);
  const { count, error } = await db.from("decision_cards").select("id", { count: "exact", head: true }).eq("company_id", id).eq("day", date);
  if (error) throw dbError("Could not count the day's cards", error);
  return count ?? 0;
}

/** The cards opened on one owner-local day, in the order they were opened (seq). */
export async function listCardsOpenedOn(db: DbClient, companyId: string, day: string): Promise<readonly CardRecord[]> {
  const id = UuidSchema.parse(companyId);
  const date = DAY_SCHEMA.parse(day);
  const { data, error } = await db.from("decision_cards").select(CARD_COLUMNS).eq("company_id", id).eq("day", date).order("seq", { ascending: true });
  if (error) throw dbError("Could not list the day's cards", error);
  return Object.freeze((data ?? []).map(toCardRecord));
}
