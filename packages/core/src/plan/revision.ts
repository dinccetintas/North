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
