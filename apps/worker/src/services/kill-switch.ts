import { listTasks, recordAction } from "@north/db";
import type { WorkerDeps } from "../deps";

/** Kill switch: pause every active campaign through the ads adapter and record it (K1, notified). */
export async function pauseEverything(deps: WorkerDeps, companyId: string): Promise<{ readonly paused: readonly string[] }> {
  const { paused } = await deps.integrations.ads.pauseAll(companyId);
  await recordAction(deps.db, {
    companyId,
    taskId: null,
    agentRole: "ops_finance",
    kind: "ads.pause",
    tier: "K1",
    description: `Kill switch: paused ${paused.length} campaign(s)`,
    payload: { campaignIds: [...paused] },
    status: "notified",
    sandbox: deps.integrations.mode === "sandbox",
  });
  return { paused };
}

/** Resume: every queued task is dispatched again; dispatch itself checks the flag. */
export async function queuedTaskIds(deps: WorkerDeps, companyId: string): Promise<readonly string[]> {
  const tasks = await listTasks(deps.db, companyId, { status: ["queued"] });
  return Object.freeze(tasks.map((t) => t.id));
}

/** Tasks waiting on quota-deferred actions, grouped so the retry cron can re-dispatch them. */
export async function deferredTaskIds(deps: WorkerDeps): Promise<readonly { readonly companyId: string; readonly taskId: string }[]> {
  const { data, error } = await deps.db
    .from("actions")
    .select("company_id, task_id, payload")
    .eq("status", "blocked")
    .not("task_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`could not load deferred actions: ${error.message}`);
  const seen = new Set<string>();
  const out: { companyId: string; taskId: string }[] = [];
  for (const row of data ?? []) {
    const payload = row.payload as { quota_deferred?: boolean; retried?: boolean } | null;
    if (!payload?.quota_deferred || payload.retried || !row.task_id || seen.has(row.task_id)) continue;
    seen.add(row.task_id);
    out.push({ companyId: row.company_id, taskId: row.task_id });
  }
  return Object.freeze(out);
}
