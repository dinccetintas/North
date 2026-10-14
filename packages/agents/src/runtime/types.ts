import type { ActionSpec } from "@north/core";

/** One task for one role. The runtime never sees credentials. */
export interface AgentRunInput {
  readonly companyId: string;
  readonly taskId: string;
  readonly role: string;
  readonly taskType: string;
  readonly instructions: string;
  readonly memoryDigest: string;
  readonly workspaceDir: string;
  /** JSON schema the result must satisfy (Agent SDK outputFormat). */
  readonly outputSchema: Record<string, unknown>;
  /** Answer to a decision card when resuming a waiting task. */
  readonly resume?: { readonly sessionId: string; readonly cardId: string; readonly optionId: string };
  /** Values for the role prompt placeholders ({{company.name}}, {{thesis}}, {{goals}}, {{budgets}}, {{quota}}). */
  readonly vars?: Readonly<Record<string, string>>;
}

export interface AgentRunUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
}

export type AgentRunResult =
  | { readonly status: "succeeded"; readonly output: unknown; readonly actions: readonly ActionSpec[]; readonly sessionId: string; readonly usage: AgentRunUsage }
  | { readonly status: "waiting_decision"; readonly cardId: string; readonly sessionId: string; readonly usage: AgentRunUsage }
  | { readonly status: "failed"; readonly error: string; readonly sessionId: string | null; readonly usage: AgentRunUsage };

export interface AgentRuntime {
  readonly name: "claude-agent-sdk" | "mock";
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
