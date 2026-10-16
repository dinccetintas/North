import { randomUUID } from "node:crypto";
import { PlanOutputSchema, missingRevisionReasons, outputJsonSchema, weekStartLocal, type DispatchBlockReason, type PlanOutput } from "@north/core";
import { LEADS_COUNT_VAR, LEDGER_REPORT_VAR, PLAN_PREVIOUS_VAR, SITE_URL_VAR, sandboxMinutesOf, type AgentRunResult, type PreviousPlanVar } from "@north/agents";
import { companyOwnerId, countLeads, createPlanWithTasks, createTask, getProfile, latestPlan, listGoals, listMemoryItems, listSignals, markTaskDone, markTaskFailed, markTaskRunning, recordAgentRun, siteUrls, type PlanRecord, type TaskRecord } from "@north/db";
import type { WorkerDeps } from "../deps";
import { companyContext, type CompanyContext } from "./company-context";
import { chargeRun, releaseRun, reserveRun, type RunReservation } from "./credits";
import { dispatchAllowed } from "./entitlements";
import { ledgerReport } from "./plan-report";

export type PlanWeekResult =
  | { readonly kind: "created"; readonly planId: string; readonly taskIds: readonly string[] }
  /** PLN-2: the Chief of Staff could not explain a shrunk task type twice; the planning task is failed and the brief shows it. */
  | { readonly kind: "rejected"; readonly taskId: string; readonly missing: readonly string[] }
  /** ADR 0014: dispatch refused (kill switch, ended subscription, credits); nothing was created. */
  | { readonly kind: "skipped"; readonly skipped: DispatchBlockReason };

const MAX_CONTEXT_LINES = 5;
const ESCALATION_PREFIX = "Escalated:";
const OPEN_SIGNAL_STATUSES = ["card_opened", "deferred", "capped", "scored"] as const;

export interface PlanContext extends CompanyContext {
  readonly previous: PlanRecord | null;
  readonly previousTasks: readonly { readonly taskType: string }[];
  readonly timezone: string;
  readonly weekStart: string;
  /** Escalations and open signals, as text lines for the planning task's input. */
  readonly notes: readonly string[];
}

const previousVar = (plan: PlanRecord): string => {
  const value: PreviousPlanVar = { weekStart: plan.weekStart, tasks: plan.tasks.slice(0, 50).map((t) => ({ taskType: t.taskType, title: t.title.slice(0, 200), status: t.status })) };
  return JSON.stringify(value);
};

/**
 * PLN-2: what the Chief of Staff plans from: the company context, the previous
 * plan and its task statuses (`vars["plan.previous"]`), the channel report of
 * the ledger entries since that plan (`vars["ledger.report"]`), the lead count
 * and the site URL, plus escalations and open signals as notes.
 */
export async function planContext(deps: WorkerDeps, companyId: string): Promise<PlanContext> {
  const { db } = deps;
  const now = deps.clock();
  const base = await companyContext(db, companyId);
  const [previous, ownerId, leads, site, memory, signals] = await Promise.all([latestPlan(db, companyId), companyOwnerId(db, companyId), countLeads(db, companyId), siteUrls(db, companyId), listMemoryItems(db, companyId, 100), listSignals(db, companyId, { status: [...OPEN_SIGNAL_STATUSES], sinceDays: 14, limit: 20 })]);
  const timezone = (await getProfile(db, ownerId))?.timezone ?? "UTC";
  const report = await ledgerReport(db, companyId, previous?.createdAt ?? null);
  const escalations = memory.filter((m) => m.kind === "learning" && m.title.startsWith(ESCALATION_PREFIX) && (!previous || m.createdAt >= previous.createdAt)).slice(0, MAX_CONTEXT_LINES);
  const notes = [...escalations.map((m) => `Escalation: ${m.title.slice(0, 160)}`), ...signals.slice(0, MAX_CONTEXT_LINES).map((s) => `Open signal (${s.source}, ${s.status}, score ${s.score}): ${s.title.slice(0, 160)}`)];
  const vars = {
    ...base.vars,
    ...(previous ? { [PLAN_PREVIOUS_VAR]: previousVar(previous) } : {}),
    [LEDGER_REPORT_VAR]: JSON.stringify(report.slice(0, 100)),
    [LEADS_COUNT_VAR]: String(leads),
    [SITE_URL_VAR]: site.live ?? site.preview ?? "",
  };
  return Object.freeze({ ...base, vars: Object.freeze(vars), previous, previousTasks: previous?.tasks.map((t) => ({ taskType: t.taskType })) ?? [], timezone, weekStart: weekStartLocal(timezone, now), notes });
}

/** A planning run's id and its credit, reserved before it starts (M6 review L9). */
interface PlanningCharge {
  readonly agentRunId: string;
  readonly reservation: RunReservation;
}

/** Reserves the next planning run's credit; null when the balance is 0 (nothing starts). */
async function reservePlanning(deps: WorkerDeps, companyId: string): Promise<PlanningCharge | null> {
  const agentRunId = randomUUID();
  const reservation = await reserveRun(deps, companyId, agentRunId);
  return reservation.ok ? { agentRunId, reservation } : null;
}

/** A reserved planning run that throws before it is recorded never ran: its credit is released. */
async function releasedOnThrow<T>(deps: WorkerDeps, charge: PlanningCharge, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    await releaseRun(deps, charge.agentRunId, charge.reservation);
    throw cause;
  }
}

/** The planning run's `agent_runs` row under its reserved id, its trace and, in the same call, its usage (BIL-2). */
async function recordPlanningRun(deps: WorkerDeps, task: TaskRecord, result: AgentRunResult, traceId: string | null, charge: PlanningCharge): Promise<void> {
  const agentRunId = await recordAgentRun(deps.db, {
    id: charge.agentRunId,
    companyId: task.companyId,
    taskId: task.id,
    role: "chief_of_staff",
    model: result.usage.model,
    runtime: deps.runtime.name,
    sessionId: result.sessionId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
    durationMs: result.usage.durationMs,
    status: result.status,
    ...(result.status === "failed" ? { error: result.error } : {}),
    traceId,
  });
  await chargeRun(deps, task.companyId, agentRunId, { usage: result.usage, sandboxMinutes: sandboxMinutesOf(result) }, charge.reservation);
}

const revisionRetryNote = (missing: readonly string[]): string =>
  `Retry: the previous answer was rejected (PLN-2). Every task type with fewer tasks than the previous plan must carry a revisions entry with change "fewer" or "dropped" and a reason from the ledger. Missing reasons for: ${missing.join(", ")}.`;

type RunOutcome = { readonly kind: "plan"; readonly plan: PlanOutput; readonly costUsd: number } | { readonly kind: "failed"; readonly error: string } | { readonly kind: "rejected"; readonly missing: readonly string[] };

/** One planning run under its reserved credit, parsed and checked against PLN-2; `retryNote` names the missing types on the second attempt. */
async function runPlanning(deps: WorkerDeps, task: TaskRecord, context: PlanContext, retryNote: string | null, charge: PlanningCharge): Promise<RunOutcome> {
  const instructions = [retryNote, context.header, task.input, ...context.notes].filter((line): line is string => line !== null && line.length > 0).join("\n\n");
  const traceId = deps.tracer.startRun({ companyId: task.companyId, taskId: task.id, role: "chief_of_staff", taskType: "plan_week", instructions });
  const result = await releasedOnThrow(deps, charge, () => deps.runtime.run({
    companyId: task.companyId,
    taskId: task.id,
    role: "chief_of_staff",
    taskType: "plan_week",
    instructions,
    memoryDigest: context.digest,
    workspaceDir: `${deps.env.WORKSPACE_ROOT}/${task.id}`,
    outputSchema: outputJsonSchema("plan_week"),
    vars: context.vars,
    ...(traceId ? { traceId } : {}),
  }));
  deps.tracer.endRun(traceId, { model: result.usage.model, costUsd: result.usage.costUsd, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, status: result.status });
  await recordPlanningRun(deps, task, result, result.traceId ?? traceId, charge);
  if (result.status !== "succeeded") return { kind: "failed", error: result.status === "failed" ? result.error : "planning cannot wait on a decision" };
  const parsed = PlanOutputSchema.safeParse(result.output);
  if (!parsed.success) return { kind: "failed", error: `plan output invalid: ${parsed.error.issues[0]?.message ?? "schema"}` };
  const missing = missingRevisionReasons(parsed.data, context.previousTasks);
  return missing.length > 0 ? { kind: "rejected", missing } : { kind: "plan", plan: parsed.data, costUsd: result.usage.costUsd };
}

/**
 * PLN-1 / PLN-2: the Chief of Staff turns the goal, the memory, the previous
 * plan and the channel report into this week's plan. The planning run is a
 * task so its cost and evidence are recorded like any other work. A plan
 * that shrinks a task type without a reason is retried once with the types
 * named, then the planning task fails. The week is the owner's local week;
 * the Monday cron (`planTick`) asks only when the latest plan is older.
 * Dispatch asks first (ADR 0014): a refusal plans nothing; each planning run's
 * credit is reserved before it starts (M6 review L9), so at a balance of 0
 * nothing is created and a retry without credits fails the planning task.
 */
export async function planWeek(deps: WorkerDeps, companyId: string): Promise<PlanWeekResult> {
  const { db } = deps;
  const allowed = await dispatchAllowed(deps, companyId);
  if (!allowed.ok) return { kind: "skipped", skipped: allowed.reason };
  const first = await reservePlanning(deps, companyId);
  if (!first) return { kind: "skipped", skipped: "credits_exhausted" };
  const { context, goal, planningTask } = await releasedOnThrow(deps, first, async () => {
    const context = await planContext(deps, companyId);
    const goal = (await listGoals(db, companyId)).find((g) => g.status === "active") ?? null;
    const planningTask = await createTask(db, {
      companyId,
      role: "chief_of_staff",
      taskType: "plan_week",
      title: `Weekly plan for ${context.weekStart}`,
      input: goal ? `Active goal: ${goal.metricKey} → ${goal.targetValue} by ${goal.dueDate}` : "No active goal yet; plan the first validation week.",
      metricKey: goal?.metricKey ?? "artifacts",
    });
    await markTaskRunning(db, planningTask.id);
    return { context, goal, planningTask };
  });

  let run = await runPlanning(deps, planningTask, context, null, first);
  if (run.kind === "rejected") {
    const retry = await reservePlanning(deps, companyId);
    if (!retry) {
      await markTaskFailed(db, planningTask.id, `PLN-2: the plan shrank ${run.missing.join(", ")} without a reason; no credits left for the retry`);
      return { kind: "skipped", skipped: "credits_exhausted" };
    }
    run = await runPlanning(deps, planningTask, context, revisionRetryNote(run.missing), retry);
  }
  if (run.kind === "rejected") {
    await markTaskFailed(db, planningTask.id, `PLN-2: the plan shrank ${run.missing.join(", ")} without a reason, twice`);
    return { kind: "rejected", taskId: planningTask.id, missing: run.missing };
  }
  if (run.kind === "failed") {
    await markTaskFailed(db, planningTask.id, run.error);
    throw new Error(`plan_week failed: ${run.error}`);
  }
  const created = await createPlanWithTasks(db, { companyId, goalId: goal?.id ?? null, weekStart: context.weekStart, summary: run.plan.summary, rationale: run.plan.rationale, tasks: run.plan.tasks, revisions: run.plan.revisions });
  await markTaskDone(db, planningTask.id, { evidence: { kind: "artifact_id", ref: `plan:${created.planId}`, verified: true, sandbox: deps.runtime.name === "mock" }, costUsd: run.costUsd, outputSummary: run.plan.summary });
  return { kind: "created", planId: created.planId, taskIds: created.taskIds };
}
