import { ScoredSignalSchema, sanitizeText, type ScoredSignal, type SignalSource } from "@north/core";
import type { ScoreCandidate, ScoreContext } from "./prompt";

/**
 * The deterministic stand-in for the classifier (PRO-1): source weight ×
 * keyword overlap × recency. It never fails, so a scan never fails on the
 * model; it is also the ordering a test can reason about by hand.
 */
export const SOURCE_WEIGHT: Readonly<Record<SignalSource, number>> = Object.freeze({
  producthunt: 0.9,
  reddit: 0.85,
  competitor_sites: 0.75,
  metrics: 0.75,
  google_trends: 0.5,
  sentry: 1,
});

/** Overlap floor: a candidate with no keyword hit still scores this fraction of its source weight. */
const OVERLAP_FLOOR = 0.4;
/** Recency: full weight today, this floor at `RECENCY_DAYS` and beyond. */
const RECENCY_FLOOR = 0.5;
const RECENCY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_MAX = 200;
const RATIONALE_MAX = 300;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

const tokens = (text: string): ReadonlySet<string> => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0));

/** The fraction of keywords that appear (as a whole word or a prefix of one) in the text; 0 with no keywords. */
export function keywordOverlap(text: string, keywords: readonly string[]): number {
  const words = tokens(text);
  const wanted = keywords.map((k) => k.toLowerCase().trim()).filter((k) => k.length > 0);
  if (wanted.length === 0) return 0;
  const hits = wanted.filter((k) => words.has(k) || [...words].some((w) => w.startsWith(k))).length;
  return hits / wanted.length;
}

/** 1 for an observation at or after `now`, falling linearly to the floor at seven days and staying there. */
export function recencyFactor(observedAt: string, now: Date): number {
  const age = (now.getTime() - new Date(observedAt).getTime()) / DAY_MS;
  if (!Number.isFinite(age) || age <= 0) return 1;
  return Math.max(RECENCY_FLOOR, 1 - (age / RECENCY_DAYS) * (1 - RECENCY_FLOOR));
}

export interface HeuristicOptions extends ScoreContext {
  readonly now: Date;
}

/** One candidate's heuristic score with a summary (its title) and a rationale naming the three factors. */
export function heuristicScore(candidate: ScoreCandidate, options: HeuristicOptions): ScoredSignal {
  const weight = SOURCE_WEIGHT[candidate.source];
  const overlap = keywordOverlap(`${candidate.title} ${candidate.excerpt}`, options.keywords);
  const recency = recencyFactor(candidate.observedAt, options.now);
  const score = round2(clamp01(weight * (OVERLAP_FLOOR + (1 - OVERLAP_FLOOR) * overlap) * recency));
  const hits = Math.round(overlap * options.keywords.length);
  return Object.freeze(
    ScoredSignalSchema.parse({
      id: candidate.id,
      score,
      summary: sanitizeText(candidate.title).slice(0, SUMMARY_MAX),
      rationale: `Heuristic (model unavailable): source ${candidate.source} weight ${weight}, ${hits}/${options.keywords.length} keywords, recency ${round2(recency)}.`.slice(0, RATIONALE_MAX),
    }),
  );
}

/** Every candidate scored, in the input order. */
export function heuristicScores(candidates: readonly ScoreCandidate[], options: HeuristicOptions): readonly ScoredSignal[] {
  return Object.freeze(candidates.map((candidate) => heuristicScore(candidate, options)));
}
