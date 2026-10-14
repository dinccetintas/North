import {
  AGENT_ROLES,
  EvidenceSchema,
  METRIC_KEYS,
  TASK_STATUSES,
  TASK_TYPES,
  transition,
  type Evidence,
  type MetricKey,
  type TaskEvent,
  type TaskStatus,
  type TaskType,
} from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { readInputText, toJson, UuidSchema } from "./json";
import type { TablesUpdate } from "./types";

export interface TaskRecord {
  readonly id: string;
  readonly companyId: string;
  readonly planId: string | null;
  readonly role: string;
  readonly taskType: TaskType;
  readonly title: string;
  readonly input: string;
  readonly status: TaskStatus;
  readonly evidence: Evidence | null;
  readonly costUsd: number;
  readonly metricKey: MetricKey | null;
  readonly expectedDelta: number | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly outputSummary: string | null;
  /** What the agent run produced, kept so a task parked on a card can finish later with its evidence. */
  readonly result: TaskResult;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const TaskResultSchema = z.object({
  artifactIds: z.array(UuidSchema).max(20).default([]),
  costUsd: z.number().nonnegative().default(0),
  summary: z.string().max(4000).default(""),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type TaskResultInput = z.input<typeof TaskResultSchema>;

export const CreateTaskInputSchema = z.object({
  companyId: UuidSchema,
  planId: UuidSchema.nullable().default(null),
  role: z.enum(AGENT_ROLES),
  taskType: z.enum(TASK_TYPES),
  title: z.string().trim().min(1).max(200),
  input: z.string().max(4000).default(""),
  metricKey: z.enum(METRIC_KEYS).nullable().default(null),
  expectedDelta: z.number().nullable().default(null),
});
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;

export const TaskDoneInputSchema = z.object({
  evidence: EvidenceSchema,
  costUsd: z.number().nonnegative(),
  outputSummary: z.string().max(4000),
});
export type TaskDoneInput = z.input<typeof TaskDoneInputSchema>;

export interface ListTasksOptions {
  readonly status?: readonly TaskStatus[];
  readonly planId?: string;
}

const TASK_COLUMNS =
  "id, company_id, plan_id, role, task_type, title, input, status, evidence, cost_usd, metric_key, expected_delta, attempts, last_error, output_summary, result, created_at, updated_at";

const TaskRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  plan_id: z.string().nullable(),
  role: z.string(),
  task_type: z.enum(TASK_TYPES),
  title: z.string(),
  input: z.unknown(),
  status: z.enum(TASK_STATUSES),
  evidence: EvidenceSchema.nullable(),
  cost_usd: z.number(),
  metric_key: z.enum(METRIC_KEYS).nullable(),
  expected_delta: z.number().nullable(),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  output_summary: z.string().nullable(),
  result: z.unknown(),
  created_at: z.string(),
  updated_at: z.string(),
});

const toResult = (value: unknown): TaskResult => {
  const parsed = TaskResultSchema.safeParse(value ?? {});
  return Object.freeze(parsed.success ? { ...parsed.data, artifactIds: Object.freeze([...parsed.data.artifactIds]) as string[] } : { artifactIds: [], costUsd: 0, summary: "" });
};

/** Maps a raw row to the immutable `TaskRecord`; throws when the row is malformed. */
export function toTaskRecord(row: unknown): TaskRecord {
  const r = TaskRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    planId: r.plan_id,
    role: r.role,
    taskType: r.task_type,
    title: r.title,
    input: readInputText(r.input),
    status: r.status,
    evidence: r.evidence ? Object.freeze(r.evidence) : null,
    costUsd: r.cost_usd,
    metricKey: r.metric_key,
    expectedDelta: r.expected_delta,
    attempts: r.attempts,
    lastError: r.last_error,
    outputSummary: r.output_summary,
    result: toResult(r.result),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

/** Stores the run's artifact ids, cost and summary on the task; the settlement path reads them back as evidence. */
export async function saveTaskResult(db: DbClient, taskId: string, input: TaskResultInput): Promise<void> {
  const id = UuidSchema.parse(taskId);
  const result = TaskResultSchema.parse(input);
  const { error } = await db.from("tasks").update({ result: toJson(result), output_summary: result.summary }).eq("id", id);
  if (error) throw dbError("Could not save task result", error);
}

/** Creates a queued task. The free-text input is stored as `{ text }` in the jsonb column. */
export async function createTask(db: DbClient, input: CreateTaskInput): Promise<TaskRecord> {
  const t = CreateTaskInputSchema.parse(input);
  const { data, error } = await db
    .from("tasks")
    .insert({
      company_id: t.companyId,
      plan_id: t.planId,
      role: t.role,
      task_type: t.taskType,
      title: t.title,
      input: { text: t.input },
      metric_key: t.metricKey,
      expected_delta: t.expectedDelta,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error || !data) throw dbError("Could not create task", error);
  return toTaskRecord(data);
}

/** One task by id, or null when it does not exist or is not visible under RLS. */
export async function getTask(db: DbClient, taskId: string): Promise<TaskRecord | null> {
  const id = UuidSchema.parse(taskId);
  const { data, error } = await db.from("tasks").select(TASK_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load task", error);
  return data ? toTaskRecord(data) : null;
}

/** Tasks of a company, oldest first, optionally filtered by status and plan. */
export async function listTasks(db: DbClient, companyId: string, opts: ListTasksOptions = {}): Promise<readonly TaskRecord[]> {
  const id = UuidSchema.parse(companyId);
  const base = db.from("tasks").select(TASK_COLUMNS).eq("company_id", id);
  const byStatus = opts.status && opts.status.length > 0 ? base.in("status", [...opts.status]) : base;
  const byPlan = opts.planId ? byStatus.eq("plan_id", UuidSchema.parse(opts.planId)) : byStatus;
  const { data, error } = await byPlan.order("created_at", { ascending: true });
  if (error) throw dbError("Could not list tasks", error);
  return Object.freeze((data ?? []).map(toTaskRecord));
}

type TaskPatch = Pick<TablesUpdate<"tasks">, "cost_usd" | "output_summary" | "last_error">;

/**
 * Loads the task, runs the pure core state machine and persists the new state.
 * The write is guarded by the previous status/attempts so a concurrent change
 * surfaces as a `DbError` instead of a silent overwrite. Illegal transitions
 * throw `TaskTransitionError` before anything is written.
 */
async function applyEvent(db: DbClient, taskId: string, chooseEvent: (task: TaskRecord) => TaskEvent, patch: TaskPatch = {}): Promise<TaskRecord> {
  const current = await getTask(db, taskId);
  if (!current) throw new DbError(`Task ${taskId} not found`);
  const event = chooseEvent(current);
  const next = transition({ status: current.status, attempts: current.attempts, evidence: current.evidence }, event);
  const { data, error } = await db
    .from("tasks")
    .update({ status: next.status, attempts: next.attempts, evidence: next.evidence ? toJson(next.evidence) : null, ...patch })
    .eq("id", current.id)
    .eq("status", current.status)
    .eq("attempts", current.attempts)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) throw dbError(`Could not apply "${event.type}" to task ${taskId}`, error);
  if (!data) throw new DbError(`Task ${taskId} changed concurrently; "${event.type}" was not applied`);
  return toTaskRecord(data);
}

/** queued/failed → running (counts an attempt); waiting_decision → running (resume). */
export function markTaskRunning(db: DbClient, taskId: string): Promise<TaskRecord> {
  return applyEvent(db, taskId, (task) => (task.status === "waiting_decision" ? { type: "resume" } : { type: "start" }));
}

/** running → waiting_decision while a decision card is open. */
export function markTaskWaiting(db: DbClient, taskId: string): Promise<TaskRecord> {
  return applyEvent(db, taskId, () => ({ type: "wait_decision" }));
}

/** running → done. Requires verified evidence (AGT-2); records cost and the output summary. */
export function markTaskDone(db: DbClient, taskId: string, input: TaskDoneInput): Promise<TaskRecord> {
  const done = TaskDoneInputSchema.parse(input);
  return applyEvent(db, taskId, () => ({ type: "complete", evidence: done.evidence }), {
    cost_usd: done.costUsd,
    output_summary: done.outputSummary,
  });
}

/** running/waiting_decision → failed, keeping the error for the retry or escalation. */
export function markTaskFailed(db: DbClient, taskId: string, error: string): Promise<TaskRecord> {
  const reason = z.string().min(1).max(4000).parse(error);
  return applyEvent(db, taskId, () => ({ type: "fail", reason }), { last_error: reason });
}
