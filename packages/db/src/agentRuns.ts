import { localDay } from "@north/core";
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

/** One recorded agent run (OBS-1): the cost line the dashboard reads. */
export interface AgentRunRecord {
  readonly id: string;
  readonly companyId: string;
  readonly taskId: string | null;
  readonly role: string;
  readonly model: string;
  readonly runtime: AgentRuntime;
  readonly sessionId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly status: AgentRunStatus;
  readonly error: string | null;
  readonly createdAt: string;
}

export interface CostByRole {
  readonly role: string;
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface CostByDay {
  /** `YYYY-MM-DD` in the zone `costSummary` was asked for (UTC by default). */
  readonly day: string;
  readonly runs: number;
  readonly costUsd: number;
}

/** Usage and cost of a company over a window (OBS-1), aggregated in code from one select. */
export interface CostSummary {
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  /** Most expensive role first. */
  readonly byRole: readonly CostByRole[];
  /** Oldest day first. */
  readonly byDay: readonly CostByDay[];
}

export interface CostSummaryOptions {
  /** The zone whose days `byDay` is keyed on; the owner's zone on the settings page. */
  readonly timezone?: string;
}

const RUN_COLUMNS = "id, company_id, task_id, role, model, runtime, session_id, input_tokens, output_tokens, cost_usd, duration_ms, status, error, created_at";
const COST_ROW_LIMIT = 5000;

const RunRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  task_id: z.string().nullable(),
  role: z.string(),
  model: z.string(),
  runtime: z.enum(AGENT_RUNTIMES),
  session_id: z.string().nullable(),
  input_tokens: z.coerce.number(),
  output_tokens: z.coerce.number(),
  cost_usd: z.coerce.number(),
  duration_ms: z.number(),
  status: z.enum(AGENT_RUN_STATUSES),
  error: z.string().nullable(),
  created_at: z.string(),
});

const CostRowSchema = z.object({ role: z.string(), input_tokens: z.coerce.number(), output_tokens: z.coerce.number(), cost_usd: z.coerce.number(), created_at: z.string() });
type CostRow = z.infer<typeof CostRowSchema>;

/** Maps a raw row to the immutable `AgentRunRecord`; throws when the row is malformed. */
export function toAgentRunRecord(row: unknown): AgentRunRecord {
  const r = RunRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    taskId: r.task_id,
    role: r.role,
    model: r.model,
    runtime: r.runtime,
    sessionId: r.session_id,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    durationMs: r.duration_ms,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
  });
}

/** Records one agent run (model, tokens, cost, duration, outcome); worker only. Returns its id. */
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

/** The company's runs, newest first, up to `limit`. */
export async function listRecentRuns(db: DbClient, companyId: string, limit = 50): Promise<readonly AgentRunRecord[]> {
  const id = UuidSchema.parse(companyId);
  const max = z.number().int().positive().max(1000).parse(limit);
  const { data, error } = await db.from("agent_runs").select(RUN_COLUMNS).eq("company_id", id).order("created_at", { ascending: false }).limit(max);
  if (error) throw dbError("Could not list agent runs", error);
  return Object.freeze((data ?? []).map(toAgentRunRecord));
}

/** Floating-point sums of dollar amounts, rounded to the cent-of-a-cent so `0.5 + 0.25 + 2` prints as `2.75`. */
const usd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function groupByRole(rows: readonly CostRow[]): readonly CostByRole[] {
  const groups = new Map<string, CostByRole>();
  for (const r of rows) {
    const g = groups.get(r.role) ?? { role: r.role, runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    groups.set(r.role, { role: r.role, runs: g.runs + 1, inputTokens: g.inputTokens + r.input_tokens, outputTokens: g.outputTokens + r.output_tokens, costUsd: usd(g.costUsd + r.cost_usd) });
  }
  return Object.freeze(
    [...groups.values()].sort((a, b) => b.costUsd - a.costUsd || a.role.localeCompare(b.role)).map((g) => Object.freeze(g)),
  );
}

function groupByDay(rows: readonly CostRow[], timezone: string): readonly CostByDay[] {
  const groups = new Map<string, CostByDay>();
  for (const r of rows) {
    const day = localDay(timezone, new Date(r.created_at));
    const g = groups.get(day) ?? { day, runs: 0, costUsd: 0 };
    groups.set(day, { day, runs: g.runs + 1, costUsd: usd(g.costUsd + r.cost_usd) });
  }
  return Object.freeze([...groups.values()].sort((a, b) => a.day.localeCompare(b.day)).map((g) => Object.freeze(g)));
}

/**
 * OBS-1: runs, tokens and cost of the last `sinceDays` days, by role and by
 * day. One select (at most 5000 rows, newest first) aggregated in code.
 */
export async function costSummary(db: DbClient, companyId: string, sinceDays: number, opts: CostSummaryOptions = {}): Promise<CostSummary> {
  const id = UuidSchema.parse(companyId);
  const days = z.number().positive().max(3650).parse(sinceDays);
  const timezone = z.string().min(1).max(64).default("UTC").parse(opts.timezone);
  const { data, error } = await db
    .from("agent_runs")
    .select("role, input_tokens, output_tokens, cost_usd, created_at")
    .eq("company_id", id)
    .gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(COST_ROW_LIMIT);
  if (error) throw dbError("Could not summarise agent runs", error);
  const rows = (data ?? []).map((row) => CostRowSchema.parse(row));
  return Object.freeze({
    runs: rows.length,
    inputTokens: rows.reduce((sum, r) => sum + r.input_tokens, 0),
    outputTokens: rows.reduce((sum, r) => sum + r.output_tokens, 0),
    costUsd: usd(rows.reduce((sum, r) => sum + r.cost_usd, 0)),
    byRole: groupByRole(rows),
    byDay: groupByDay(rows, timezone),
  });
}
