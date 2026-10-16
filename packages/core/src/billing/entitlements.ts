import { z } from "zod";
import { invoiceSubscriptionId, isCheckoutEvent, planInvoiceLine, unixToIso, type BillingEvent, type BillingInvoiceObject, type BillingSubscriptionObject, type CheckoutEvent, type StripeSubscriptionStatus } from "./events";
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

/** The end a tick writes (an expired trial, a subscription Stripe says is gone): `ended` now, retention from now; an ended one is returned as is. */
export function endedEntitlement(entitlement: Entitlement, now: Date): Entitlement {
  return entitlement.status === "ended" ? entitlement : Object.freeze(ended(entitlement, now));
}

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

/** M1: a Stripe status after which agents stop (the tick ends an entitlement whose subscription Stripe reports so). */
export const stripeStatusEnds = (status: StripeSubscriptionStatus): boolean => subscriptionStatus(status, false) === "ended";

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
  const status = subscriptionStatus(object.status, object.cancel_at_period_end);
  if (status === null) return entitlement;
  const base: Entitlement = {
    ...entitlement,
    ...(plan ? planFields(plan) : {}),
    ...subscriptionPeriod(object),
    stripeSubscriptionId: object.id,
    stripeCustomerId: object.customer ?? entitlement.stripeCustomerId,
  };
  if (status === "ended") return ended(base, now);
  const cancelAt = status === "canceled" ? (object.cancel_at === null ? base.periodEnd : unixToIso(object.cancel_at)) : null;
  return { ...revived(base), status, cancelAt };
}

/** A plan invoice of the followed (or first) subscription: the plan line's period, past due or trial resolved. */
function applyInvoicePaid(entitlement: Entitlement, object: BillingInvoiceObject): Entitlement {
  const line = planInvoiceLine(object);
  if (entitlement.status === "ended" || line === null) return entitlement;
  const status: EntitlementStatus = entitlement.status === "past_due" || entitlement.status === "trialing" ? "active" : entitlement.status;
  return {
    ...entitlement,
    periodStart: unixToIso(line.period.start),
    periodEnd: unixToIso(line.period.end),
    status,
    stripeSubscriptionId: invoiceSubscriptionId(object) ?? entitlement.stripeSubscriptionId,
    stripeCustomerId: object.customer ?? entitlement.stripeCustomerId,
  };
}

/** L13: a subscription checkout names its subscription for adoption only once its payment settled (an unpaid one may still expire incomplete). */
const settledPayment = (object: CheckoutEvent["data"]["object"]): boolean => object.payment_status === "paid" || object.payment_status === "no_payment_required";

function applyCheckout(entitlement: Entitlement, event: CheckoutEvent): Entitlement {
  const object = event.data.object;
  const adopts = object.mode === "subscription" && settledPayment(object);
  return {
    ...entitlement,
    stripeCustomerId: object.customer ?? entitlement.stripeCustomerId,
    stripeSubscriptionId: adopts ? (object.subscription ?? entitlement.stripeSubscriptionId) : entitlement.stripeSubscriptionId,
  };
}

function project(entitlement: Entitlement, event: BillingEvent, now: Date): Entitlement {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
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

/** The subscription an event is about; null for a payment-mode checkout. */
function subscriptionOf(event: BillingEvent): string | null {
  if (isCheckoutEvent(event)) return event.data.object.mode === "subscription" ? event.data.object.subscription : null;
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") return invoiceSubscriptionId(event.data.object);
  return event.data.object.id;
}

const isOlder = (entitlement: Entitlement, event: BillingEvent): boolean => entitlement.lastEventCreated !== null && event.created < entitlement.lastEventCreated;

/** Why an event leaves the entitlement exactly as it is (the worker logs it and skips the effects); null when it applies. */
export type BillingEventIgnoredReason = "incomplete" | "another subscription" | "no subscription" | "not a plan invoice" | "not followed";

/** Only a newer `created` adopts a subscription other than the followed one (a resubscribe; a late event never). */
function subscriptionIgnored(entitlement: Entitlement, event: Extract<BillingEvent, { type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted" }>): BillingEventIgnoredReason | null {
  const object = event.data.object;
  const status = event.type === "customer.subscription.deleted" ? "ended" : subscriptionStatus(object.status, object.cancel_at_period_end);
  if (status === null) return "incomplete";
  const followed = entitlement.stripeSubscriptionId;
  if (followed === null) return status === "ended" ? "not followed" : null;
  if (object.id === followed) return null;
  return event.type === "customer.subscription.created" && !isOlder(entitlement, event) ? null : "another subscription";
}

function invoiceIgnored(entitlement: Entitlement, event: Extract<BillingEvent, { type: "invoice.paid" | "invoice.payment_failed" }>): BillingEventIgnoredReason | null {
  const subscription = invoiceSubscriptionId(event.data.object);
  const followed = entitlement.stripeSubscriptionId;
  if (subscription === null) return "no subscription";
  if (followed !== null && subscription !== followed) return "another subscription";
  if (event.type === "invoice.payment_failed") return followed === null ? "not followed" : null;
  return planInvoiceLine(event.data.object) === null ? "not a plan invoice" : null;
}

/**
 * M6 review M1 / M3 / L13: the entitlement follows one subscription. An event
 * about another one changes nothing, unless it is a newer `created`, which
 * adopts it (a resubscribe; a late or replayed one never); an entitlement
 * that follows none adopts the first live one it sees (a subscription
 * checkout included), never a dead one or a failed payment.
 * An `incomplete` subscription says nothing; an invoice changes the
 * entitlement only when it pays for a plan period (`planInvoiceLine`).
 */
export function ignoredBecause(entitlement: Entitlement, event: BillingEvent): BillingEventIgnoredReason | null {
  if (isCheckoutEvent(event)) {
    const subscription = subscriptionOf(event);
    return subscription !== null && entitlement.stripeSubscriptionId !== null && subscription !== entitlement.stripeSubscriptionId ? "another subscription" : null;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") return invoiceIgnored(entitlement, event);
  return subscriptionIgnored(entitlement, event);
}

type StatusFields = Pick<Entitlement, "status" | "cancelAt" | "endedAt" | "retentionUntil" | "purgeDue" | "periodStart" | "periodEnd" | "lastEventCreated">;
const statusFields = (e: Entitlement): StatusFields => ({ status: e.status, cancelAt: e.cancelAt, endedAt: e.endedAt, retentionUntil: e.retentionUntil, purgeDue: e.purgeDue, periodStart: e.periodStart, periodEnd: e.periodEnd, lastEventCreated: e.lastEventCreated });

/** An ended entitlement comes back through the subscription that ended only on a strictly newer event: Stripe never revives a deleted subscription. */
const staleFor = (entitlement: Entitlement, event: BillingEvent): boolean =>
  isOlder(entitlement, event) || (entitlement.status === "ended" && event.created === entitlement.lastEventCreated && subscriptionOf(event) === entitlement.stripeSubscriptionId);

/**
 * The pure projection: the entitlement after one event; the very same object
 * when the event is ignored (`ignoredBecause`). `now` stamps an end. An event
 * created before the one last applied may still fill the plan and the Stripe
 * ids (Stripe does not order `subscription.created` and `invoice.paid`), but
 * never moves the status, the period or the end dates, with one exception:
 * the followed subscription's `deleted` is terminal whenever it arrives (M1).
 */
export function applyBillingEvent(entitlement: Entitlement, event: BillingEvent, now: Date): Entitlement {
  if (ignoredBecause(entitlement, event) !== null) return entitlement;
  const projected = project(entitlement, event, now);
  const last = entitlement.lastEventCreated;
  if (event.type === "customer.subscription.deleted") return Object.freeze({ ...projected, lastEventCreated: Math.max(last ?? event.created, event.created) });
  return Object.freeze(staleFor(entitlement, event) ? { ...projected, ...statusFields(entitlement) } : { ...projected, lastEventCreated: event.created });
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
