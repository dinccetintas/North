import { MAX_ATTEMPTS } from "@north/core";
import { getTask, writeMemoryItems } from "@north/db";
import type { WorkerDeps } from "../deps";

export type AttemptDecision = { readonly next: "retry"; readonly attempt: number } | { readonly next: "escalate"; readonly reason: string } | { readonly next: "none" };

/**
 * AGT-3 after a failed run: one more attempt with a different approach, then
 * escalation. The decision is taken from the task row (attempts, last error),
 * never from the event, so a replayed dispatch cannot add attempts.
 */
export async function attemptDecision(deps: WorkerDeps, taskId: string): Promise<AttemptDecision> {
  const task = await getTask(deps.db, taskId);
  if (!task || task.status !== "failed") return { next: "none" };
  if (task.attempts < MAX_ATTEMPTS) return { next: "retry", attempt: task.attempts + 1 };
  return { next: "escalate", reason: task.lastError ?? "failed twice" };
}

/** Writes the learning the Chief of Staff and the brief need, so the failure is not lost in a log. */
export async function escalateTask(deps: WorkerDeps, taskId: string, reason: string): Promise<{ readonly escalated: true; readonly reason: string }> {
  const task = await getTask(deps.db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  await writeMemoryItems(
    deps.db,
    task.companyId,
    [{ kind: "learning", title: `Escalated: ${task.title}`.slice(0, 120), content: `${task.role} failed "${task.title}" twice (${task.taskType}). Last error: ${reason.slice(0, 1500)}. The Chief of Staff decides the next step; the CEO sees it in the brief.` }],
    "chief_of_staff",
  );
  return { escalated: true, reason };
}

/** The note the second attempt gets, so the agent does not repeat the first approach. */
export function retryInstructions(attempt: number, lastError: string | null): string {
  return `Attempt #${attempt} of ${MAX_ATTEMPTS}. The previous attempt failed${lastError ? `: ${lastError.slice(0, 800)}` : ""}. Try a clearly different approach and say in the summary what you changed.`;
}
