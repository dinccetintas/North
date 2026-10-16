import { endedEntitlement, periodPlanGrant, stripeStatusEnds, type Entitlement } from "@north/core";
import { EntitlementConflictError, insertCreditEntries, listEntitlementsToHeal, listEntitlementsToReconcile, saveEntitlement } from "@north/db";
import { isSandboxBilling } from "@north/integrations";
import type { WorkerDeps } from "../deps";
import { endSubscription, type CompanyEvent } from "./entitlements";

/**
 * M6 security review M1, part of `entitlements-tick`: a subscription whose end
 * never arrived. A row following a subscription that is not ended, whose
 * `cancel_at` (else `period_end`) is more than `RECONCILE_AFTER_DAYS` past,
 * should have been moved by a webhook (the renewal's `invoice.paid`, the
 * `subscription.deleted`). The worker asks the provider for that very
 * subscription and ends the entitlement, through the kill switch, when the
 * provider says it is gone or ended. A live answer, an error or ids of the
 * other mode (a sandbox id under live keys, or the reverse) end nothing.
 */
export const RECONCILE_AFTER_DAYS = 3;
const DAY_MS = 86_400_000;

type Verdict = "ended" | "live" | "skip";

const isSandboxId = (id: string): boolean => id.includes("_sandbox_");

async function providerVerdict(deps: WorkerDeps, row: Entitlement): Promise<Verdict> {
  const { stripeCustomerId: customer, stripeSubscriptionId: subscription } = row;
  if (!customer || !subscription) return "skip";
  if (isSandboxId(subscription) !== isSandboxBilling(deps.integrations.billing)) {
    console.warn(`[billing] reconcile: ${row.userId} follows ${subscription}, not of this billing mode; left alone`);
    return "skip";
  }
  try {
    const found = await deps.integrations.billing.subscription(customer, subscription);
    if (found === null || stripeStatusEnds(found.status)) return "ended";
    console.warn(`[billing] reconcile: ${subscription} is ${found.status} at the provider but its period passed without a webhook`);
    return "live";
  } catch (cause) {
    console.warn(`[billing] reconcile: ${subscription} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
    return "skip";
  }
}

/** The end, observed now: no event created before this instant can move the entitlement back (core's ordering rule). */
async function endObserved(deps: WorkerDeps, row: Entitlement, now: Date): Promise<boolean> {
  const ended: Entitlement = { ...endedEntitlement(row, now), lastEventCreated: Math.max(row.lastEventCreated ?? 0, Math.floor(now.getTime() / 1000)) };
  try {
    await saveEntitlement(deps.db, row, ended);
    return true;
  } catch (cause) {
    if (cause instanceof EntitlementConflictError) return false;
    throw cause;
  }
}

export interface Reconciled {
  readonly checked: number;
  readonly ended: readonly string[];
  readonly events: readonly CompanyEvent[];
}

export async function reconcileSubscriptions(deps: WorkerDeps): Promise<Reconciled> {
  const now = deps.clock();
  const rows = await listEntitlementsToReconcile(deps.db, new Date(now.getTime() - RECONCILE_AFTER_DAYS * DAY_MS));
  const ended: string[] = [];
  const events: CompanyEvent[] = [];
  for (const row of rows) {
    if ((await providerVerdict(deps, row)) !== "ended" || !(await endObserved(deps, row, now))) continue;
    const stopped = await endSubscription(deps, row.userId);
    ended.push(row.userId);
    events.push(...stopped.events);
  }
  return Object.freeze({ checked: rows.length, ended: Object.freeze(ended), events: Object.freeze(events) });
}

/**
 * BIL-2, also in `entitlements-tick`: the self-heal of a lost plan grant. An
 * `invoice.paid` is marked applied before its credits step; when that step
 * never succeeds (its retries spent), the period would go without its
 * credits. For every running entitlement on a priced subscription (`active`,
 * or `canceled` at a period end still ahead: that period was paid) whose
 * period started at least `HEAL_AFTER_HOURS` ago, the period's grant is
 * written with the entitlement's
 * `monthly_credits` under the invoice's own ref (`plan:<subscription>:<periodStart>`):
 * the ref makes it a no-op when the grant exists, and a late `invoice.paid`
 * then grants nothing. "Running 24 h after the period start" stands for "the
 * period's invoice is paid" only because checkouts are card only (founder
 * default, `StripeBilling.checkout`): a card renewal is paid or `past_due`
 * within the hour. Offering a delayed method (ACH, SEPA) later needs this
 * heal to confirm the period's invoice is paid first.
 */
export const HEAL_AFTER_HOURS = 24;
const HOUR_MS = 3_600_000;

export interface Healed {
  readonly checked: number;
  readonly healed: readonly string[];
}

export async function healPlanGrants(deps: WorkerDeps): Promise<Healed> {
  const now = deps.clock();
  const rows = await listEntitlementsToHeal(deps.db, new Date(now.getTime() - HEAL_AFTER_HOURS * HOUR_MS), now);
  const healed: string[] = [];
  for (const row of rows) {
    const grant = periodPlanGrant(row);
    if (!grant || (await insertCreditEntries(deps.db, row.userId, [grant])).length === 0) continue;
    console.warn(`[billing] healed the missing plan grant ${grant.ref} (+${grant.amount}) of ${row.userId}`);
    healed.push(row.userId);
  }
  return Object.freeze({ checked: rows.length, healed: Object.freeze(healed) });
}
