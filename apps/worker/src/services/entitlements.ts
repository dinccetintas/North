import { dispatchDecision, EVENT, retentionUntil, shouldEndTrial, type DispatchDecision, type Entitlement } from "@north/core";
import { creditBalance, getCompanyById, getEntitlementForCompany, listCompaniesByOwner, listTrialsToEnd, setKillSwitch, unarchiveCompany, upsertEntitlement } from "@north/db";
import type { WorkerDeps } from "../deps";

/**
 * BIL-1 / BIL-2 (ADR 0014): what the entitlement means for agents. Every
 * dispatch path asks `dispatchAllowed` first; the end of a subscription is
 * the kill switch with the reason `subscription_ended` on every company of
 * the owner, and a new subscription lifts exactly those pauses. The services
 * return the events; the Inngest function sends them (all I/O in steps).
 */

/** An Inngest event a billing effect asks the function to send. */
export interface CompanyEvent {
  readonly name: typeof EVENT.companyKillSwitch | typeof EVENT.companyResume;
  readonly data: { readonly companyId: string };
}

const eventFor = (name: CompanyEvent["name"], companyId: string): CompanyEvent => Object.freeze({ name, data: Object.freeze({ companyId }) });

/**
 * The kill switch first (its reason says whether billing set it), then the
 * owner's entitlement, then the credit balance: core `dispatchDecision` on
 * the rows. An unknown company is refused (fail closed). The balance is read
 * only when the switch and the entitlement allow.
 */
export async function dispatchAllowed(deps: WorkerDeps, companyId: string): Promise<DispatchDecision> {
  const company = await getCompanyById(deps.db, companyId);
  if (!company) return dispatchDecision({ killSwitchActive: true, entitlement: null, balance: 0 });
  const now = deps.clock();
  if (company.killSwitchActive) return dispatchDecision({ killSwitchActive: true, pausedReason: company.pausedReason, entitlement: null, balance: 0, now });
  const entitlement = await getEntitlementForCompany(deps.db, companyId);
  const balance = entitlement && entitlement.status !== "ended" ? await creditBalance(deps.db, entitlement.userId) : 0;
  return dispatchDecision({ killSwitchActive: false, pausedReason: company.pausedReason, entitlement, balance, now });
}

export interface SubscriptionEffect {
  readonly userId: string;
  /** The companies the effect touched, oldest first. */
  readonly companies: readonly string[];
  readonly events: readonly CompanyEvent[];
}

export interface EndedSubscription extends SubscriptionEffect {
  /** Milliseconds of the worker's clock from the first flag to the last (the 5 s SLA is measured from the webhook by the harness). */
  readonly ms: number;
}

/**
 * Agents stop: every company of the owner that is not archived carries the
 * kill switch; a running one takes the reason `subscription_ended`, one the
 * user already paused keeps `user` (the repository refuses to overwrite it).
 * One `company/killswitch` per company, so `cancelOn` and the campaign
 * pauses do what M2-M4 proved. Idempotent: a second call flags nothing new.
 */
export async function endSubscription(deps: WorkerDeps, userId: string): Promise<EndedSubscription> {
  const started = deps.clock().getTime();
  const companies = (await listCompaniesByOwner(deps.db, userId)).filter((c) => c.status !== "archived");
  for (const company of companies) await setKillSwitch(deps.db, company.id, true, "subscription_ended");
  const ids = companies.map((c) => c.id);
  return Object.freeze({ userId, companies: Object.freeze(ids), events: Object.freeze(ids.map((id) => eventFor(EVENT.companyKillSwitch, id))), ms: deps.clock().getTime() - started });
}

/**
 * A subscription is active again: the pauses billing set are lifted (a
 * user's own pause stays), companies the retention sweep archived before a
 * purge are restored, and each gets `company/resume`, which redispatches the
 * queue and opens the M4 resume card for paused campaigns.
 */
export async function reactivate(deps: WorkerDeps, userId: string): Promise<SubscriptionEffect> {
  const touched: string[] = [];
  for (const company of await listCompaniesByOwner(deps.db, userId)) {
    if (company.status === "archived" && company.pausedReason === "retention") {
      await unarchiveCompany(deps.db, company.id);
      touched.push(company.id);
    } else if (company.status !== "archived" && company.pausedReason === "subscription_ended") {
      await setKillSwitch(deps.db, company.id, false);
      touched.push(company.id);
    }
  }
  return Object.freeze({ userId, companies: Object.freeze(touched), events: Object.freeze(touched.map((id) => eventFor(EVENT.companyResume, id))) });
}

/** The trial ends like a cancelled subscription: `ended` now, retention from now. */
const endedTrial = (entitlement: Entitlement, now: Date): Entitlement => Object.freeze({ ...entitlement, status: "ended", endedAt: now.toISOString(), retentionUntil: retentionUntil(now), cancelAt: null });

/** `entitlements-tick` (hourly, and `billing/tick`): trials past their period end with no subscription end, then stop their agents. */
export async function endExpiredTrials(deps: WorkerDeps): Promise<{ readonly ended: readonly string[]; readonly events: readonly CompanyEvent[] }> {
  const now = deps.clock();
  const ended: string[] = [];
  const events: CompanyEvent[] = [];
  for (const trial of await listTrialsToEnd(deps.db, now)) {
    if (!shouldEndTrial(trial, now)) continue;
    await upsertEntitlement(deps.db, endedTrial(trial, now));
    const stopped = await endSubscription(deps, trial.userId);
    ended.push(trial.userId);
    events.push(...stopped.events);
  }
  return Object.freeze({ ended: Object.freeze(ended), events: Object.freeze(events) });
}
