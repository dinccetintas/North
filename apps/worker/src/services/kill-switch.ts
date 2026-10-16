import { isActive } from "@north/core";
import { getCompanyById, getEntitlementForCompany, listCards, listTasks, pendingActionForCard } from "@north/db";
import type { WorkerDeps } from "../deps";
import { listDeferredRows } from "./actions";
import { pauseForKillSwitch, type KillSwitchPause } from "./campaigns";

export type ResumeDecision = { readonly ok: true } | { readonly ok: false; readonly reason: "subscription_ended" | "retention" };

/**
 * ADR 0014: `company/resume` is refused while the owner's entitlement is not
 * active (`subscription_ended`: the pause billing set stays, and a pause the
 * user lifted meanwhile reopens no campaign) or the company is archived
 * (`retention`). Only a new subscription (`reactivate`) lifts those.
 */
export async function resumeAllowed(deps: WorkerDeps, companyId: string): Promise<ResumeDecision> {
  const company = await getCompanyById(deps.db, companyId);
  if (company && (company.status === "archived" || company.pausedReason === "retention")) return Object.freeze({ ok: false, reason: "retention" });
  const entitlement = await getEntitlementForCompany(deps.db, companyId);
  if (!entitlement || !isActive(entitlement)) return Object.freeze({ ok: false, reason: "subscription_ended" });
  return Object.freeze({ ok: true });
}

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
