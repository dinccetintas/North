import { ActionSpecSchema, type ActionSpec } from "@north/core";
import { getTask, recordActionTransition, type DbClient, type TaskRecord } from "@north/db";

export interface DeferredRow {
  readonly id: string;
  readonly companyId: string;
  readonly taskId: string;
  readonly spec: ActionSpec;
}

const DEFERRED_SCAN_LIMIT = 1000;
const FINISHED: ReadonlySet<string> = new Set(["done", "failed"]);

/** Ids among `ids` that some later row supersedes (the retry marker row carries no quota flag, so it is looked up explicitly). */
async function supersededAmong(db: DbClient, ids: readonly string[]): Promise<Set<string>> {
  const { data, error } = await db.from("actions").select("supersedes").in("supersedes", [...ids]);
  if (error) throw new Error(`could not check action chains: ${error.message}`);
  return new Set((data ?? []).flatMap((r) => (r.supersedes ? [r.supersedes] : [])));
}

/** Whether each task is already done or failed (M4 review M2: such a row is owed nothing and must not re-dispatch the task). */
async function finishedTasks(db: DbClient, taskIds: ReadonlySet<string>): Promise<Set<string>> {
  const finished = new Set<string>();
  for (const taskId of taskIds) {
    const task = await getTask(db, taskId);
    if (task && FINISHED.has(task.status)) finished.add(taskId);
  }
  return finished;
}

/**
 * Quota-deferred actions still waiting for a retry: blocked rows flagged
 * `quota_deferred` whose chain has not moved on and whose task is still
 * open. A retry appends a "retried" transition, so the original row is
 * superseded and never picked up twice; a row of a finished task is closed
 * with a "stale" transition on sight, for the same reason.
 */
export async function listDeferredRows(db: DbClient, taskId?: string): Promise<readonly DeferredRow[]> {
  const base = db.from("actions").select("id, company_id, task_id, payload, supersedes").eq("status", "blocked").contains("payload", { quota_deferred: true }).not("task_id", "is", null);
  const { data, error } = await (taskId ? base.eq("task_id", taskId) : base).order("created_at", { ascending: true }).limit(DEFERRED_SCAN_LIMIT);
  if (error) throw new Error(`could not load deferred actions: ${error.message}`);
  const rows = (data ?? []).filter((r): r is typeof r & { task_id: string } => r.task_id !== null);
  const superseded = rows.length === 0 ? new Set<string>() : await supersededAmong(db, rows.map((r) => r.id));
  const live = rows.filter((r) => !superseded.has(r.id));
  const finished = await finishedTasks(db, new Set(live.map((r) => r.task_id)));
  const out: DeferredRow[] = [];
  for (const row of live) {
    if (finished.has(row.task_id)) {
      await recordActionTransition(db, { actionId: row.id, status: "blocked", note: "stale" });
      continue;
    }
    const parsed = ActionSpecSchema.safeParse((row.payload as { spec?: unknown }).spec);
    if (parsed.success) out.push({ id: row.id, companyId: row.company_id, taskId: row.task_id, spec: parsed.data });
  }
  return Object.freeze(out);
}

/** Actions stored as quota-deferred for a task, so a retry re-gates them instead of re-running the agent. Each is marked retried. */
export async function deferredActionsFor(db: DbClient, task: TaskRecord): Promise<readonly ActionSpec[]> {
  const rows = await listDeferredRows(db, task.id);
  for (const row of rows) {
    await recordActionTransition(db, { actionId: row.id, status: "blocked", note: "retried" });
  }
  return Object.freeze(rows.map((r) => r.spec));
}
