import { z } from "zod";
import { invoiceSubscriptionId, unixToIso, type BillingEvent, type BillingInvoiceObject, type BillingSubscriptionObject, type StripeSubscriptionStatus } from "./events";
import { planByLookupKey, RETENTION_DAYS, SUBSCRIPTION_PLAN_IDS, SUBSCRIPTION_PLANS, TRIAL_DAYS, type SubscriptionPlan, type SubscriptionPlanId } from "./plans";

/**
 * BIL-1 (ADR 0014): one `entitlements` row per user, projected from billing
 * events by the worker through `applyBillingEvent` (pure), read by the web,
 * enforced by the database trigger at company creation and by
 * `dispatchDecision` at every agent run.
 */
export const ENTITLEMENT_STATUSES = ["trialing", "active", "past_due", "canceled", "ended"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

const Iso = z.iso.datetime({ offset: true });
const StripeId = z.string().min(1).max(200).nullable();

export const EntitlementSchema = z.object({
  userId: z.uuid(),
  planId: z.enum(SUBSCRIPTION_PLAN_IDS),
  status: z.enum(ENTITLEMENT_STATUSES),
  companyLimit: z.number().int().positive(),
  monthlyCredits: z.number().int().nonnegative(),
  /** What the user pays per period; 0 for a trial. The usage ratio divides by it. */
  priceUsd: z.number().nonnegative(),
  periodStart: Iso,
  periodEnd: Iso,
  /** `canceled`: when the subscription stops; the entitlement is active until then. */
  cancelAt: Iso.nullable(),
  stripeCustomerId: StripeId,
  stripeSubscriptionId: StripeId,
  endedAt: Iso.nullable(),
  /** RET-1: `endedAt` + 90 d; the sweep archives and marks `purgeDue` after it. */
  retentionUntil: Iso.nullable(),
  purgeDue: z.boolean(),
  /** `created` of the newest event applied; an older event never regresses the status. */
  lastEventCreated: z.number().int().nonnegative().nullable(),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

const DAY_MS = 86_400_000;
const addDays = (date: Date, days: number): string => new Date(date.getTime() + days * DAY_MS).toISOString();

/** RET-1: the day the data may be purged, 90 days after the end. */
export function retentionUntil(endedAt: Date | string): string {
  return addDays(typeof endedAt === "string" ? new Date(endedAt) : endedAt, RETENTION_DAYS);
}

type PlanFields = Pick<Entitlement, "planId" | "companyLimit" | "monthlyCredits" | "priceUsd">;
const planFields = (plan: SubscriptionPlan): PlanFields => ({ planId: plan.id, companyLimit: plan.companyLimit, monthlyCredits: plan.monthlyCredits, priceUsd: plan.priceUsd });

/** A new user's 14-day Solo trial, no card: Solo's limits and credits, no price (ADR 0014). */
export function trialEntitlement(userId: string, now: Date): Entitlement {
  return Object.freeze({
    userId,
    ...planFields(SUBSCRIPTION_PLANS.solo),
    priceUsd: 0,
    status: "trialing",
    periodStart: now.toISOString(),
    periodEnd: addDays(now, TRIAL_DAYS),
    cancelAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    endedAt: null,
    retentionUntil: null,
    purgeDue: false,
    lastEventCreated: null,
  });
}

/** Everything but `ended` keeps agents running: a `canceled` subscription runs until its period end, `past_due` until Stripe closes it. */
export function isActive(entitlement: Pick<Entitlement, "status">): boolean {
  return entitlement.status !== "ended";
}

const ended = (entitlement: Entitlement, now: Date): Entitlement =>
  entitlement.status === "ended" ? entitlement : { ...entitlement, status: "ended", endedAt: now.toISOString(), retentionUntil: retentionUntil(now), cancelAt: null };

/** A live subscription clears what the end set; the sweep's archive is reversed by the worker (`reactivate`). */
const revived = (entitlement: Entitlement): Entitlement => ({ ...entitlement, endedAt: null, retentionUntil: null, purgeDue: false });

/** Stripe's status onto ours; null when the event says nothing about it (`incomplete`). */
function subscriptionStatus(status: StripeSubscriptionStatus, cancelAtPeriodEnd: boolean): EntitlementStatus | null {
  switch (status) {
    case "active":
      return cancelAtPeriodEnd ? "canceled" : "active";
    case "trialing":
      return cancelAtPeriodEnd ? "canceled" : "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return "ended";
    case "incomplete":
      return null;
  }
}

/** The period from the subscription or, on newer API versions, its first item; nothing when neither carries it. */
function subscriptionPeriod(object: BillingSubscriptionObject): Partial<Pick<Entitlement, "periodStart" | "periodEnd">> {
  const item = object.items.data[0];
  const start = object.current_period_start ?? item?.current_period_start;
  const end = object.current_period_end ?? item?.current_period_end;
  return start !== undefined && end !== undefined ? { periodStart: unixToIso(start), periodEnd: unixToIso(end) } : {};
}

function applySubscription(entitlement: Entitlement, object: BillingSubscriptionObject, now: Date): Entitlement {
  const lookupKey = object.items.data[0]?.price?.lookup_key;
  const plan = lookupKey ? planByLookupKey(lookupKey) : null;
  const base: Entitlement = {
    ...entitlement,
    ...(plan ? planFields(plan) : {}),
    ...subscriptionPeriod(object),
    stripeSubscriptionId: object.id,
    stripeCustomerId: object.customer ?? entitlement.stripeCustomerId,
  };
  const status = subscriptionStatus(object.status, object.cancel_at_period_end);
  if (status === null) return base;
  if (status === "ended") return ended(base, now);
  const cancelAt = status === "canceled" ? (object.cancel_at === null ? base.periodEnd : unixToIso(object.cancel_at)) : null;
  return { ...revived(base), status, cancelAt };
}

function applyInvoicePaid(entitlement: Entitlement, object: BillingInvoiceObject): Entitlement {
  if (entitlement.status === "ended") return entitlement;
  const line = object.lines.data[0];
  const period = line ? { periodStart: unixToIso(line.period.start), periodEnd: unixToIso(line.period.end) } : {};
  const status: EntitlementStatus = entitlement.status === "past_due" || entitlement.status === "trialing" ? "active" : entitlement.status;
  return {
    ...entitlement,
    ...period,
    status,
    stripeSubscriptionId: invoiceSubscriptionId(object) ?? entitlement.stripeSubscriptionId,
    stripeCustomerId: object.customer ?? entitlement.stripeCustomerId,
  };
}

function applyCheckout(entitlement: Entitlement, event: Extract<BillingEvent, { type: "checkout.session.completed" }>): Entitlement {
  const object = event.data.object;
  return {
    ...entitlement,
    stripeCustomerId: object.customer ?? entitlement.stripeCustomerId,
    stripeSubscriptionId: object.mode === "subscription" ? (object.subscription ?? entitlement.stripeSubscriptionId) : entitlement.stripeSubscriptionId,
  };
}

function project(entitlement: Entitlement, event: BillingEvent, now: Date): Entitlement {
  switch (event.type) {
    case "checkout.session.completed":
      return applyCheckout(entitlement, event);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applySubscription(entitlement, event.data.object, now);
    case "customer.subscription.deleted":
      return ended(entitlement, now);
    case "invoice.paid":
      return applyInvoicePaid(entitlement, event.data.object);
    case "invoice.payment_failed":
      return entitlement.status === "ended" ? entitlement : { ...entitlement, status: "past_due" };
  }
}

/**
 * An update or delete for a subscription other than the one the entitlement
 * follows (a late delete of the previous subscription after a re-subscribe)
 * must not touch the current one. `created` always adopts the new
 * subscription; a trial with no subscription adopts whatever it sees first.
 */
function concernsAnotherSubscription(entitlement: Entitlement, event: BillingEvent): boolean {
  if (event.type !== "customer.subscription.updated" && event.type !== "customer.subscription.deleted") return false;
  return entitlement.stripeSubscriptionId !== null && event.data.object.id !== entitlement.stripeSubscriptionId;
}

type StatusFields = Pick<Entitlement, "status" | "cancelAt" | "endedAt" | "retentionUntil" | "purgeDue" | "periodStart" | "periodEnd" | "lastEventCreated">;
const statusFields = (e: Entitlement): StatusFields => ({ status: e.status, cancelAt: e.cancelAt, endedAt: e.endedAt, retentionUntil: e.retentionUntil, purgeDue: e.purgeDue, periodStart: e.periodStart, periodEnd: e.periodEnd, lastEventCreated: e.lastEventCreated });

/**
 * The pure projection: the entitlement after one event. `now` stamps an end.
 * An event created before the one last applied may still fill the plan and
 * the Stripe ids (Stripe does not order `subscription.created` and
 * `invoice.paid`), but never moves the status, the period or the end dates.
 */
export function applyBillingEvent(entitlement: Entitlement, event: BillingEvent, now: Date): Entitlement {
  if (concernsAnotherSubscription(entitlement, event)) return entitlement;
  const projected = project(entitlement, event, now);
  const older = entitlement.lastEventCreated !== null && event.created < entitlement.lastEventCreated;
  return Object.freeze(older ? { ...projected, ...statusFields(entitlement) } : { ...projected, lastEventCreated: event.created });
}

export type CompanyCreationCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const plural = (n: number): string => (n === 1 ? "company" : "companies");

function planLimitMessage(planId: SubscriptionPlanId, limit: number): string {
  const plan = SUBSCRIPTION_PLANS[planId];
  const next = SUBSCRIPTION_PLAN_IDS[SUBSCRIPTION_PLAN_IDS.indexOf(planId) + 1];
  const upgrade = next ? ` Upgrade to ${SUBSCRIPTION_PLANS[next].name} for ${SUBSCRIPTION_PLANS[next].companyLimit}.` : "";
  return `${plan.name} includes ${limit} ${plural(limit)}.${upgrade}`;
}

/** BIL-1: the web's message before the trigger `companies_within_entitlement` says the same thing. `activeCount` is the owner's non-archived companies. */
export function canCreateCompany(entitlement: Entitlement, activeCount: number): CompanyCreationCheck {
  if (!isActive(entitlement)) return Object.freeze({ ok: false, reason: "Your subscription has ended. Subscribe to create a company." });
  if (activeCount < entitlement.companyLimit) return Object.freeze({ ok: true });
  return Object.freeze({ ok: false, reason: planLimitMessage(entitlement.planId, entitlement.companyLimit) });
}

/** A trial past its period end with no subscription ends like a cancelled one (`entitlements-tick`). */
export function shouldEndTrial(entitlement: Entitlement, now: Date): boolean {
  return entitlement.status === "trialing" && entitlement.stripeSubscriptionId === null && Date.parse(entitlement.periodEnd) <= now.getTime();
}

export type EntitlementTransition = "ended" | "reactivated" | "past_due" | null;

/** What the worker's `effects` step acts on: the kill switch, the resume, or one past-due notification. */
export function entitlementTransition(before: Pick<Entitlement, "status">, after: Pick<Entitlement, "status">): EntitlementTransition {
  if (after.status === "ended") return before.status === "ended" ? null : "ended";
  if (before.status === "ended") return "reactivated";
  if (after.status === "past_due") return before.status === "past_due" ? null : "past_due";
  return null;
}
