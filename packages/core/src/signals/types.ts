import { z } from "zod";
import { isHttpUrl } from "../url";

/**
 * Signals (PRO-1, ADR 0012): a row per observation from a source; it becomes a
 * card only through the gate (`signal.pursue`).
 */
export const SIGNAL_KINDS = ["opportunity", "metric_drop", "error"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_STATUSES = ["new", "scored", "below_threshold", "card_opened", "deferred", "capped", "approved", "declined", "converted"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const SIGNAL_SOURCES = ["reddit", "producthunt", "google_trends", "competitor_sites", "metrics", "sentry"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/** A scored signal at or above this opens a card; below it is recorded and nothing more. */
export const SIGNAL_THRESHOLD = 0.7;
/** PRO-3-CAP: at most one `opportunity` card per company per ISO week of the owner's day. */
export const OPPORTUNITY_CARDS_PER_WEEK = 1;
/** One scan opens at most this many cards, so a scan cannot empty the day's quota. */
export const SIGNAL_CARDS_PER_SCAN = 1;
/** The most candidates one scoring call takes. */
export const SIGNAL_SCORE_BATCH = 20;

/** An http(s) URL without credentials; `javascript:`, `sandbox://` and friends are never signal evidence. */
const EvidenceUrlSchema = z.string().max(2048).refine((value) => isHttpUrl(value), { message: "http(s) URL without credentials" });

/** What a `SignalSource` adapter returns for one observation; the worker inserts it `new` (or `below_threshold` for a baseline). */
export const SignalCandidateSchema = z.object({
  source: z.enum(SIGNAL_SOURCES),
  sourceRef: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  excerpt: z.string().max(600).default(""),
  url: EvidenceUrlSchema.nullable(),
  observedAt: z.iso.datetime({ offset: true }),
  /** A first sighting (competitor page) stored for comparison, never scored. */
  baseline: z.boolean().default(false),
});
export type SignalCandidate = z.infer<typeof SignalCandidateSchema>;

/** One score from the classifier; ids outside the batch are dropped by the caller. */
export const ScoredSignalSchema = z.object({
  id: z.string().min(1).max(200),
  score: z.number().min(0).max(1),
  summary: z.string().max(200),
  rationale: z.string().max(300),
});
export type ScoredSignal = z.infer<typeof ScoredSignalSchema>;

/** The structured output of one `signal:score` call. */
export const SignalScoresSchema = z.object({ scores: z.array(ScoredSignalSchema).max(SIGNAL_SCORE_BATCH) });
export type SignalScores = z.infer<typeof SignalScoresSchema>;

/** The facts of a signal row the card, the task input and the brief read. */
export interface SignalFacts {
  readonly id: string;
  readonly companyId: string;
  readonly kind: SignalKind;
  readonly source: SignalSource;
  readonly title: string;
  readonly url: string | null;
  readonly excerpt: string;
  readonly score: number;
  readonly summary?: string | undefined;
  readonly rationale?: string | undefined;
}

/** The payload a `signal.pursue` action carries; the gate reads its facts and the perform step its task type. */
export const SignalPursuePayloadSchema = z
  .object({
    signalId: z.string().min(1).max(64),
    kind: z.enum(SIGNAL_KINDS),
    source: z.enum(SIGNAL_SOURCES),
    title: z.string().min(1).max(200),
    url: EvidenceUrlSchema.nullable(),
    score: z.number().min(0).max(1),
    taskType: z.literal("signal_research"),
  })
  .loose();
export type SignalPursuePayload = z.infer<typeof SignalPursuePayloadSchema>;

/** The signal facts of a payload, or null when it is not a valid `signal.pursue` payload. */
export function signalPayload(payload: Record<string, unknown> | undefined): SignalPursuePayload | null {
  const parsed = SignalPursuePayloadSchema.safeParse(payload);
  return parsed.success ? Object.freeze(parsed.data) : null;
}
