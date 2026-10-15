import { localDay, localHour, weekStartLocal } from "@north/core";
import { latestPlan, listActiveCompanies } from "@north/db";
import type { WorkerDeps } from "../deps";

/** The Monday rewrite hour, owner-local (PLN-2); the brief follows at 07:00 and reports the new plan. */
export const PLAN_HOUR = 6;

export interface PlanDue {
  readonly companyId: string;
  readonly weekStart: string;
}

/**
 * PLN-2, the hourly tick: companies whose owner-local time is Monday
 * `PLAN_HOUR` and whose latest plan is older than this week (or who have
 * none), skipping stopped companies. The planning itself is idempotent per
 * week, so a second tick in the same hour creates nothing.
 */
export async function planTick(deps: WorkerDeps): Promise<readonly PlanDue[]> {
  const now = deps.clock();
  const due: PlanDue[] = [];
  for (const company of await listActiveCompanies(deps.db)) {
    if (company.killSwitchActive) continue;
    const weekStart = weekStartLocal(company.timezone, now);
    if (localDay(company.timezone, now) !== weekStart || localHour(company.timezone, now) !== PLAN_HOUR) continue;
    const plan = await latestPlan(deps.db, company.companyId);
    if (plan && plan.weekStart >= weekStart) continue;
    due.push({ companyId: company.companyId, weekStart });
  }
  return Object.freeze(due);
}
