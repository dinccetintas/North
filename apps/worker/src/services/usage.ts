import { canDispatch, isActive, localMonth, usageAlertDue, usageCostUsd, usageRatio } from "@north/core";
import { creditBalance, getEntitlement, getProfile, getUsage, listActiveCompanies, listCompaniesByOwner, listNotifications, listUsageToAlert, markUsageAlerted } from "@north/db";
import type { WorkerDeps } from "../deps";
import { reportWarning } from "../observability";
import { notifyOwner } from "./notify";

/**
 * BIL-2, the spec's cost NFR: `usage-tick` (hourly, body shared with
 * `usage/tick`) finds the users whose owner-local month crossed
 * `USAGE_ALERT_RATIO` of the plan price and claims the month's one alert
 * (`usage.alerted_at`) before anything is sent; and the users whose credits
 * ran out (dispatch refuses with `credits_exhausted`), once per month, known
 * from the alert already in their log. The function then notifies each by
 * push and email (`kind: usage_alert`).
 */

export const USAGE_ALERT_KIND = "usage_alert";

export interface UsageAlert {
  readonly userId: string;
  readonly period: string;
  /** `ratio`: cost crossed 40 % of the price; `credits_exhausted`: the balance is at or below zero. */
  readonly reason: "ratio" | "credits_exhausted";
  readonly ratio: number;
  readonly costUsd: number;
  readonly priceUsd: number;
}

/** Every zone's month at this instant: UTC−12 to UTC+14 span at most two calendar months. */
function currentPeriods(now: Date): readonly string[] {
  return [...new Set(["Etc/GMT+12", "UTC", "Pacific/Kiritimati"].map((zone) => localMonth(zone, now)))];
}

const timezoneOf = async (deps: WorkerDeps, userId: string): Promise<string> => (await getProfile(deps.db, userId))?.timezone ?? "UTC";

async function ratioAlerts(deps: WorkerDeps, now: Date): Promise<readonly UsageAlert[]> {
  const due: UsageAlert[] = [];
  for (const usage of await listUsageToAlert(deps.db, currentPeriods(now))) {
    const entitlement = await getEntitlement(deps.db, usage.userId);
    if (!entitlement) continue;
    if (usage.period !== localMonth(await timezoneOf(deps, usage.userId), now)) continue;
    if (!usageAlertDue(usage, entitlement.priceUsd, usage.alertedAt)) continue;
    if (!(await markUsageAlerted(deps.db, usage.userId, usage.period, now))) continue;
    due.push(Object.freeze({ userId: usage.userId, period: usage.period, reason: "ratio", ratio: usageRatio(usage, entitlement.priceUsd), costUsd: usageCostUsd(usage), priceUsd: entitlement.priceUsd }));
  }
  return due;
}

/** The month's `credits_exhausted` alert is already in the owner's log (filed under the oldest running company, as `notifyOwner` files it). */
async function alertedForCredits(deps: WorkerDeps, userId: string, period: string): Promise<boolean> {
  const company = (await listCompaniesByOwner(deps.db, userId)).find((c) => c.status !== "archived");
  if (!company) return true;
  return (await listNotifications(deps.db, company.id, 200)).some((n) => n.kind === USAGE_ALERT_KIND && n.payload.reason === "credits_exhausted" && n.payload.period === period);
}

async function creditAlerts(deps: WorkerDeps, now: Date): Promise<readonly UsageAlert[]> {
  const due: UsageAlert[] = [];
  for (const userId of new Set((await listActiveCompanies(deps.db)).map((c) => c.ownerId))) {
    const entitlement = await getEntitlement(deps.db, userId);
    if (!entitlement || !isActive(entitlement) || canDispatch(await creditBalance(deps.db, userId))) continue;
    const period = localMonth(await timezoneOf(deps, userId), now);
    if (await alertedForCredits(deps, userId, period)) continue;
    const usage = await getUsage(deps.db, userId, period);
    due.push(Object.freeze({ userId, period, reason: "credits_exhausted", ratio: usage ? usageRatio(usage, entitlement.priceUsd) : 0, costUsd: usage ? usageCostUsd(usage) : 0, priceUsd: entitlement.priceUsd }));
  }
  return due;
}

/** The alerts this tick owes. A ratio alert is claimed (`markUsageAlerted`) here; a credits alert is owed until its notification is in the log. */
export async function usageTick(deps: WorkerDeps): Promise<readonly UsageAlert[]> {
  const now = deps.clock();
  const due = [...(await ratioAlerts(deps, now)), ...(await creditAlerts(deps, now))];
  for (const alert of due) reportWarning(`[usage] ${alert.userId} ${alert.reason === "ratio" ? `used ${Math.round(alert.ratio * 100)} % of the plan price` : "ran out of credits"} in ${alert.period} ($${alert.costUsd} of $${alert.priceUsd})`, { ...alert });
  return Object.freeze(due);
}

const percent = (ratio: number): string => `${Math.round(ratio * 100)} %`;

/** The month's alert, by push and email, linking to the usage panel and the credit packs. */
export function notifyUsageAlert(deps: WorkerDeps, alert: UsageAlert, appUrl: string): Promise<{ readonly push: number; readonly email: boolean }> {
  const url = `${appUrl.replace(/\/$/, "")}/settings/billing`;
  const payload = { period: alert.period, reason: alert.reason, ratio: alert.ratio, costUsd: alert.costUsd, priceUsd: alert.priceUsd };
  if (alert.reason === "credits_exhausted") {
    return notifyOwner(deps, alert.userId, { kind: USAGE_ALERT_KIND, title: "North: agents are waiting for credits", body: `Your credits for ${alert.period} are used up, so queued tasks wait. Add a credit pack or change plan in Billing and they resume.`, url, payload });
  }
  return notifyOwner(deps, alert.userId, {
    kind: USAGE_ALERT_KIND,
    title: `North: agents used ${percent(alert.ratio)} of your plan price`,
    body: `Agents used ${percent(alert.ratio)} of your plan price this month ($${alert.costUsd} of $${alert.priceUsd}, ${alert.period}). The usage panel shows where it went.`,
    url,
    payload,
  });
}
