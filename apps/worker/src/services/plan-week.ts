import { PlanOutputSchema, outputJsonSchema, type PlanOutput } from "@north/core";
import { createPlanWithTasks, createTask, listGoals, markTaskDone, markTaskFailed, markTaskRunning, recordAgentRun } from "@north/db";
import type { WorkerDeps } from "../deps";
import { companyContext } from "./company-context";

export interface PlanWeekResult {
  readonly planId: string;
  readonly taskIds: readonly string[];
}

/** Monday of the week containing `date` (UTC), as YYYY-MM-DD. */
export function weekStartOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * PLN-1: the Chief of Staff turns the active goal and the company memory into a
 * weekly plan. The planning run is itself a task so its cost and evidence are
 * recorded like any other work.
 */
export async function planWeek(deps: WorkerDeps, companyId: string, now = new Date()): Promise<PlanWeekResult> {
  const { db, runtime } = deps;
  const goals = await listGoals(db, companyId);
  const goal = goals.find((g) => g.status === "active") ?? null;
  const context = await companyContext(db, companyId);

  const planningTask = await createTask(db, {
    companyId,
    role: "chief_of_staff",
    taskType: "plan_week",
    title: `Weekly plan for ${weekStartOf(now)}`,
    input: goal ? `Active goal: ${goal.metricKey} → ${goal.targetValue} by ${goal.dueDate}` : "No active goal yet; plan the first validation week.",
    metricKey: goal?.metricKey ?? "artifacts",
  });
  await markTaskRunning(db, planningTask.id);

  const result = await runtime.run({
    companyId,
    taskId: planningTask.id,
    role: "chief_of_staff",
    taskType: "plan_week",
    instructions: `${context.header}\n\n${planningTask.input}`,
    memoryDigest: context.digest,
    workspaceDir: `${deps.env.WORKSPACE_ROOT}/${planningTask.id}`,
    outputSchema: outputJsonSchema("plan_week"),
    vars: context.vars,
  });

  await recordAgentRun(db, {
    companyId,
    taskId: planningTask.id,
    role: "chief_of_staff",
    model: result.usage.model,
    runtime: runtime.name,
    sessionId: result.sessionId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
    durationMs: result.usage.durationMs,
    status: result.status,
    ...(result.status === "failed" ? { error: result.error } : {}),
  });

  if (result.status !== "succeeded") {
    const error = result.status === "failed" ? result.error : "planning cannot wait on a decision";
    await markTaskFailed(db, planningTask.id, error);
    throw new Error(`plan_week failed: ${error}`);
  }

  const plan: PlanOutput = PlanOutputSchema.parse(result.output);
  const created = await createPlanWithTasks(db, {
    companyId,
    goalId: goal?.id ?? null,
    weekStart: weekStartOf(now),
    summary: plan.summary,
    rationale: plan.rationale,
    tasks: plan.tasks,
  });
  await markTaskDone(db, planningTask.id, {
    evidence: { kind: "artifact_id", ref: `plan:${created.planId}`, verified: true, sandbox: runtime.name === "mock" },
    costUsd: result.usage.costUsd,
    outputSummary: plan.summary,
  });
  return created;
}
