import type { PlanRevision } from "../tasks/types";

/**
 * PLN-2 as a contract: every task type whose count fell against the previous
 * plan must carry a revision with a reason, or the plan is rejected.
 */
export interface TypedTask {
  readonly taskType: string;
}

/** How many tasks of each type a plan has, keyed by type in order of first appearance. */
export function taskTypeCounts(tasks: readonly TypedTask[]): Readonly<Record<string, number>> {
  return Object.freeze(tasks.reduce<Record<string, number>>((counts, task) => ({ ...counts, [task.taskType]: (counts[task.taskType] ?? 0) + 1 }), {}));
}

/** The task types with fewer tasks in `next` than in `previous` (including those that vanished), in `previous` order. */
export function shrunkTaskTypes(previous: readonly TypedTask[], next: readonly TypedTask[]): readonly string[] {
  const before = taskTypeCounts(previous);
  const after = taskTypeCounts(next);
  return Object.freeze(Object.keys(before).filter((type) => (after[type] ?? 0) < (before[type] ?? 0)));
}

export interface RevisedPlan {
  readonly tasks: readonly TypedTask[];
  readonly revisions: readonly PlanRevision[];
}

const explainsShrink = (revision: PlanRevision, type: string): boolean =>
  revision.taskType === type && (revision.change === "fewer" || revision.change === "dropped") && revision.reason.trim().length > 0;

/** The shrunk task types the plan does not explain with a `fewer` or `dropped` revision; empty means the plan passes PLN-2. */
export function missingRevisionReasons(plan: RevisedPlan, previous: readonly TypedTask[]): readonly string[] {
  return Object.freeze(shrunkTaskTypes(previous, plan.tasks).filter((type) => !plan.revisions.some((revision) => explainsShrink(revision, type))));
}

/**
 * The plan without any task of `taskType`, for a type the platform cannot run
 * this week (an outreach batch with no free lead, SLS-K2). The plan still
 * passes PLN-2: every revision the planner wrote for the type goes, and when
 * the previous plan had the type it is recorded `dropped` with `reason`. A
 * plan without the type comes back unchanged; a plan of only that type may end empty.
 */
export function dropTaskType<P extends RevisedPlan>(plan: P, taskType: PlanRevision["taskType"], reason: string, previous: readonly TypedTask[]): P {
  if (!plan.tasks.some((t) => t.taskType === taskType)) return plan;
  const hadIt = previous.some((t) => t.taskType === taskType);
  const revisions = [...plan.revisions.filter((r) => r.taskType !== taskType), ...(hadIt ? [{ taskType, change: "dropped" as const, reason }] : [])];
  return Object.freeze({ ...plan, tasks: plan.tasks.filter((t) => t.taskType !== taskType), revisions });
}
