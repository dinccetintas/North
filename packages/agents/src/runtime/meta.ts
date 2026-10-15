import type { AgentRunInput, AgentRunResult } from "./types";

const MS_PER_MINUTE = 60_000;

/** Milliseconds of wall time as minutes with three decimals (60 ms resolution); never negative. */
export function elapsedMinutes(ms: number): number {
  return Math.max(0, Math.round(ms / (MS_PER_MINUTE / 1000)) / 1000);
}

/** BIL-2: the sandbox minutes a run reports; a result without the field (built by hand) counts 0. */
export function sandboxMinutesOf(result: AgentRunResult): number {
  return result.sandboxMinutes ?? 0;
}

/** The result with this run's facts: the minutes measured and the input's trace id when there is one. */
export function withRunMeta(result: AgentRunResult, input: Pick<AgentRunInput, "traceId">, sandboxMinutes: number): AgentRunResult {
  return Object.freeze({ ...result, sandboxMinutes, ...(input.traceId ? { traceId: input.traceId } : {}) });
}
