import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";

export const AGENT_RUNTIMES = ["claude-agent-sdk", "mock"] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];

export const AGENT_RUN_STATUSES = ["succeeded", "failed", "waiting_decision"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const RecordAgentRunInputSchema = z.object({
  companyId: UuidSchema,
  taskId: UuidSchema.nullable().default(null),
  role: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(100),
  runtime: z.enum(AGENT_RUNTIMES),
  sessionId: z.string().max(200).nullable().default(null),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(AGENT_RUN_STATUSES),
  error: z.string().max(4000).optional(),
});
export type RecordAgentRunInput = z.input<typeof RecordAgentRunInputSchema>;

/** Records one agent run (model, tokens, cost, duration, outcome); returns its id. */
export async function recordAgentRun(db: DbClient, input: RecordAgentRunInput): Promise<string> {
  const r = RecordAgentRunInputSchema.parse(input);
  const { data, error } = await db
    .from("agent_runs")
    .insert({
      company_id: r.companyId,
      task_id: r.taskId,
      role: r.role,
      model: r.model,
      runtime: r.runtime,
      session_id: r.sessionId,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cost_usd: r.costUsd,
      duration_ms: r.durationMs,
      status: r.status,
      error: r.error ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not record agent run", error);
  return data.id;
}
