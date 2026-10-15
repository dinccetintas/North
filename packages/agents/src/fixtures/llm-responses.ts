import type { MockResponder } from "../llm/client";
import { SIGNAL_SCORE_KEY, parseScorePromptCandidates, type ScoreCandidate } from "../signals/prompt";

/**
 * Scripted answers for `MockLlm` (the ONB-1 pattern), one record the worker
 * passes to `selectLlm(env, MOCK_LLM_RESPONSES)` in sandbox mode.
 *
 * - `onboarding:clarify` is deliberately absent: an unscripted key makes the
 *   mock throw `LlmError`, and `generateClarifyingQuestions` then falls
 *   through to core's deterministic `fallbackQuestions`, which is the answer
 *   the onboarding tests and the e2e already expect.
 * - `signal:score` answers for the sandbox sources' refs (`r-*-1`, `r-*-2`,
 *   `ph-*-1`, `gt-*`, a competitor change) so the 7-day run opens the same
 *   signal card every time; any other candidate is left to the heuristic.
 */
interface ScriptedScore {
  readonly score: number;
  readonly summary: string;
  readonly rationale: string;
}

const REDDIT_ASK = /^r-.+-1$/;
const REDDIT_NOISE = /^r-.+-2$/;
const PRODUCTHUNT = /^ph-.+-1$/;
const TRENDS = /^gt-/;

/** The score the fixture gives a sandbox candidate, or null when it is not a sandbox ref. */
export function sandboxSignalScore(candidate: Pick<ScoreCandidate, "source" | "sourceRef" | "title">): ScriptedScore | null {
  const ref = candidate.sourceRef;
  if (REDDIT_ASK.test(ref)) return { score: 0.85, summary: "A solo operator asking for exactly the tool the thesis describes.", rationale: "Direct buying signal: the post names the job, the pain and willingness to pay for review-before-send." };
  if (PRODUCTHUNT.test(ref)) return { score: 0.9, summary: "A competing launch with the same promise and strong first-day traction.", rationale: "A direct competitor move in the segment; the top comment names a gap the thesis can own." };
  if (candidate.source === "competitor_sites" && /^Changed:|page changed/i.test(candidate.title)) return { score: 0.6, summary: "A competitor's pricing page changed.", rationale: "Worth knowing (a new tier and moved positioning), not worth a decision this week on its own." };
  if (TRENDS.test(ref)) return { score: 0.3, summary: "Search interest for the keyword is flat.", rationale: "A flat trend line is context, not a signal to act on." };
  if (REDDIT_NOISE.test(ref)) return { score: 0.4, summary: "A meme thread about the keyword.", rationale: "Related subject, no buying intent, no market shift." };
  return null;
}

/** The `signal:score` responder: reads the candidates out of the prompt and answers for the sandbox refs. */
export const mockSignalScores: MockResponder = (args) => ({
  scores: parseScorePromptCandidates(args.user).flatMap((candidate) => {
    const scripted = sandboxSignalScore(candidate);
    return scripted ? [{ id: candidate.id, ...scripted }] : [];
  }),
});

export const MOCK_LLM_RESPONSES: Readonly<Record<string, unknown>> = Object.freeze({
  [SIGNAL_SCORE_KEY]: mockSignalScores,
});
