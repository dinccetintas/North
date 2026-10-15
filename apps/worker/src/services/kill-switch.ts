import { listCards, listTasks, pendingActionForCard } from "@north/db";
import type { WorkerDeps } from "../deps";
import { listDeferredRows } from "./actions";
import { pauseForKillSwitch, type KillSwitchPause } from "./campaigns";

export interface UnsettledCard {
  readonly cardId: string;
  readonly optionId: string;
  readonly answeredBy: "user" | "default" | "auto_rule";
}

/** Cards the CEO answered whose action is still pending (a run cancelled by the kill switch, a lost event): resume re-settles them. */
export async function unsettledAnsweredCards(deps: WorkerDeps, companyId: string): Promise<readonly UnsettledCard[]> {
  const out: UnsettledCard[] = [];
  for (const card of await listCards(deps.db, companyId, { limit: 200 })) {
    if (!card.answeredAt || !card.answeredOptionId) continue;
    const pending = await pendingActionForCard(deps.db, card.id);
    if (pending) out.push({ cardId: card.id, optionId: card.answeredOptionId, answeredBy: card.answeredBy ?? "user" });
  }
  return Object.freeze(out);
}

/** Kill switch (BUD-4): every active campaign is paused at the provider within the 5 s SLA and recorded (K1, notified). */
export function pauseEverything(deps: WorkerDeps, companyId: string): Promise<KillSwitchPause> {
  return pauseForKillSwitch(deps, companyId);
}

/** Resume: every queued task is dispatched again; dispatch itself checks the flag. */
export async function queuedTaskIds(deps: WorkerDeps, companyId: string): Promise<readonly string[]> {
  const tasks = await listTasks(deps.db, companyId, { status: ["queued"] });
  return Object.freeze(tasks.map((t) => t.id));
}

/** Tasks waiting on quota-deferred actions, grouped so the retry cron can re-dispatch them. */
export async function deferredTaskIds(deps: WorkerDeps): Promise<readonly { readonly companyId: string; readonly taskId: string }[]> {
  const seen = new Set<string>();
  const out: { companyId: string; taskId: string }[] = [];
  for (const row of await listDeferredRows(deps.db)) {
    if (seen.has(row.taskId)) continue;
    seen.add(row.taskId);
    out.push({ companyId: row.companyId, taskId: row.taskId });
  }
  return Object.freeze(out);
}
