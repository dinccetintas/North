import { z } from "zod";
import { SIGNAL_SCORE_BATCH, ScoredSignalSchema, sanitizeText, type ScoredSignal } from "@north/core";
import { LlmError, type LlmClient } from "../llm/client";
import { heuristicScore } from "./heuristic";
import { SIGNAL_SCORE_KEY, SIGNAL_SCORE_SYSTEM, ScoreCandidateSchema, scoreUserPrompt, type ScoreCandidate, type ScoreContext } from "./prompt";

/**
 * PRO-1 scoring: one structured call with the `classifier` alias for a batch
 * of at most `SIGNAL_SCORE_BATCH` candidates. The model's answer is validated
 * leniently and then normalised: ids outside the batch are dropped, duplicate
 * ids keep the first entry, scores are clamped to 0..1, text is bounded, and
 * any candidate the model left out gets the heuristic score. On `LlmError`
 * the heuristic stands in for the whole batch, so a scan never fails on the
 * model.
 */
export interface ScoreOptions extends ScoreContext {
  /** The clock for recency (the worker's); defaults to the wall clock. */
  readonly now?: Date;
}

const SUMMARY_MAX = 200;
const RATIONALE_MAX = 300;

/** The raw answer: numbers may be out of range and text may be long; `normalise` fixes both. */
const RawScoresSchema = z.object({
  scores: z
    .array(
      z.object({
        id: z.string(),
        score: z.number(),
        summary: z.string().default(""),
        rationale: z.string().default(""),
      }),
    )
    .max(SIGNAL_SCORE_BATCH * 2),
});
type RawScores = z.infer<typeof RawScoresSchema>;

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** The model's entries mapped onto the batch: foreign ids dropped, first entry per id, clamped and bounded. */
export function normaliseScores(raw: RawScores, batch: readonly ScoreCandidate[]): ReadonlyMap<string, ScoredSignal> {
  const byId = new Map(batch.map((c) => [c.id, c]));
  const out = new Map<string, ScoredSignal>();
  for (const entry of raw.scores) {
    const candidate = byId.get(entry.id);
    if (!candidate || out.has(entry.id)) continue;
    const summary = sanitizeText(entry.summary).slice(0, SUMMARY_MAX) || sanitizeText(candidate.title).slice(0, SUMMARY_MAX);
    const rationale = sanitizeText(entry.rationale).slice(0, RATIONALE_MAX);
    out.set(entry.id, Object.freeze(ScoredSignalSchema.parse({ id: entry.id, score: clamp01(entry.score), summary, rationale })));
  }
  return out;
}

/**
 * Scores the first `SIGNAL_SCORE_BATCH` candidates (validated with
 * `ScoreCandidateSchema`; invalid ones are dropped) and returns one
 * `ScoredSignal` per candidate, in the input order.
 */
export async function scoreSignals(candidates: readonly ScoreCandidate[], options: ScoreOptions, llm: LlmClient): Promise<readonly ScoredSignal[]> {
  const batch = candidates
    .map((c) => ScoreCandidateSchema.safeParse(c))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .slice(0, SIGNAL_SCORE_BATCH);
  if (batch.length === 0) return Object.freeze([]);
  const context = { thesis: options.thesis, keywords: options.keywords, now: options.now ?? new Date() };
  let fromModel: ReadonlyMap<string, ScoredSignal> = new Map();
  try {
    const raw = await llm.structured({ schema: RawScoresSchema, system: SIGNAL_SCORE_SYSTEM, user: scoreUserPrompt(batch, context), model: "classifier", key: SIGNAL_SCORE_KEY });
    fromModel = normaliseScores(raw, batch);
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
  }
  return Object.freeze(batch.map((candidate) => fromModel.get(candidate.id) ?? heuristicScore(candidate, context)));
}
