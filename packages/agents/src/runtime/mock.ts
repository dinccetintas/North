import { withRunMeta } from "./meta";
import type { AgentRunInput, AgentRunResult, AgentRuntime } from "./types";

export type MockScript = (input: AgentRunInput) => AgentRunResult;

const zeroUsage = (model = "mock") => Object.freeze({ model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, durationMs: 1 });

/**
 * Deterministic runtime for tests and the smoke loop (ADR 0004). Scripts are
 * keyed by `${role}:${taskType}`; unknown keys fail loudly so fixtures stay honest.
 * No subprocess runs, so every result reports `sandboxMinutes: 0` (M6).
 */
export class MockRuntime implements AgentRuntime {
  readonly name = "mock" as const;
  private readonly calls: AgentRunInput[] = [];

  constructor(private readonly scripts: ReadonlyMap<string, MockScript>) {}

  static fromRecord(record: Record<string, MockScript>): MockRuntime {
    return new MockRuntime(new Map(Object.entries(record)));
  }

  get history(): readonly AgentRunInput[] {
    return Object.freeze([...this.calls]);
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    this.calls.push(input);
    const script = this.scripts.get(`${input.role}:${input.taskType}`);
    if (!script) {
      return withRunMeta({ status: "failed", error: `MockRuntime has no script for ${input.role}:${input.taskType}`, sessionId: null, usage: zeroUsage() }, input, 0);
    }
    return withRunMeta(script(input), input, 0);
  }
}

export const mockUsage = zeroUsage;
