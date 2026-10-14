import { PlannedTaskSchema, TASK_OWNER } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";
import { createTask, listTasks, type TaskRecord } from "./tasks";

export interface PlanRecord {
  readonly id: string;
  readonly goalId: string | null;
  readonly weekStart: string;
  readonly summary: string;
  readonly rationale: string;
  readonly status: string;
  readonly createdAt: string;
  readonly tasks: readonly TaskRecord[];
}

export const CreatePlanInputSchema = z.object({
  companyId: UuidSchema,
  goalId: UuidSchema.nullable(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().trim().min(1).max(2000),
  rationale: z.string().trim().max(4000).default(""),
  tasks: z.array(PlannedTaskSchema).max(50),
});
export type CreatePlanInput = z.input<typeof CreatePlanInputSchema>;
type CreatePlan = z.output<typeof CreatePlanInputSchema>;

const PLAN_COLUMNS = "id, goal_id, week_start, summary, rationale, status, created_at";

/** Best-effort cleanup when task creation fails halfway; the plan itself is not transactional. */
async function rollbackPlan(db: DbClient, planId: string): Promise<void> {
  await db.from("tasks").delete().eq("plan_id", planId);
  await db.from("plans").delete().eq("id", planId);
}

/** Inserts the planned tasks one by one so `created_at` preserves the planner's order. */
async function insertPlanTasks(db: DbClient, plan: CreatePlan, planId: string): Promise<readonly string[]> {
  const ids: string[] = [];
  for (const t of plan.tasks) {
    const task = await createTask(db, {
      companyId: plan.companyId,
      planId,
      role: TASK_OWNER[t.taskType],
      taskType: t.taskType,
      title: t.title,
      input: t.input,
      metricKey: t.metricKey,
      expectedDelta: t.expectedDelta,
    });
    ids.push(task.id);
  }
  return Object.freeze(ids);
}

/**
 * PLN-1: stores the Chief of Staff's weekly plan and queues one task per
 * planned item, owned by the role in `TASK_OWNER`. Returns the ids in plan order.
 */
export async function createPlanWithTasks(
  db: DbClient,
  input: CreatePlanInput,
): Promise<{ readonly planId: string; readonly taskIds: readonly string[] }> {
  const plan = CreatePlanInputSchema.parse(input);
  const { data, error } = await db
    .from("plans")
    .insert({ company_id: plan.companyId, goal_id: plan.goalId, week_start: plan.weekStart, summary: plan.summary, rationale: plan.rationale })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not create plan", error);
  try {
    const taskIds = await insertPlanTasks(db, plan, data.id);
    return Object.freeze({ planId: data.id, taskIds });
  } catch (cause) {
    await rollbackPlan(db, data.id);
    throw cause;
  }
}

/** Newest plan of the company with its tasks (oldest task first), or null. */
export async function latestPlan(db: DbClient, companyId: string): Promise<PlanRecord | null> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("company_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("Could not load latest plan", error);
  if (!data) return null;
  const tasks = await listTasks(db, id, { planId: data.id });
  return Object.freeze({
    id: data.id,
    goalId: data.goal_id,
    weekStart: data.week_start,
    summary: data.summary,
    rationale: data.rationale,
    status: data.status,
    createdAt: data.created_at,
    tasks,
  });
}
