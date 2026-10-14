import type { TaskType } from "@north/core";
import type { AgentRunInput, AgentRunResult } from "../runtime/types";

/** Facts a fixture pulls out of the task input so its markdown reads as company-specific. */
export interface FixtureContext {
  readonly company: string;
  readonly customer: string;
  readonly thesis: string;
}

const DEFAULTS: FixtureContext = Object.freeze({
  company: "the company",
  customer: "early adopters",
  thesis: "an unstated thesis",
});

const COMPANY = /^\s*(?:company(?:\.name)?|company name|name)\s*[:=]\s*(.+?)\s*$/im;
const CUSTOMER = /^\s*(?:target customer|customer|persona|audience)\s*[:=]\s*(.+?)\s*$/im;
const THESIS = /^\s*(?:thesis|idea)\s*[:=]\s*(.+?)\s*$/im;

const firstMatch = (pattern: RegExp, sources: readonly string[]): string | undefined => {
  for (const source of sources) {
    const match = pattern.exec(source);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
};

const firstLine = (text: string): string | undefined =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

/** Extracts company, customer and thesis from `memoryDigest`/`instructions`; falls back to neutral wording. */
export function fixtureContext(input: AgentRunInput): FixtureContext {
  const sources = [input.memoryDigest, input.instructions];
  const thesis = firstMatch(THESIS, sources) ?? firstLine(input.memoryDigest) ?? firstLine(input.instructions) ?? DEFAULTS.thesis;
  return Object.freeze({
    company: firstMatch(COMPANY, sources) ?? DEFAULTS.company,
    customer: firstMatch(CUSTOMER, sources) ?? DEFAULTS.customer,
    thesis: thesis.slice(0, 240),
  });
}

const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/** Wraps a fixture output in a succeeded result with realistic (zero-cost) usage. */
export function succeeded(input: AgentRunInput, taskType: TaskType, output: unknown): AgentRunResult {
  const outputText = JSON.stringify(output);
  return Object.freeze({
    status: "succeeded",
    output,
    actions: [],
    sessionId: `mock-${taskType}`,
    usage: Object.freeze({
      model: "mock",
      inputTokens: approxTokens(input.instructions) + approxTokens(input.memoryDigest) + 800,
      outputTokens: approxTokens(outputText),
      costUsd: 0,
      durationMs: 1,
    }),
  });
}
