import {
  applyBillingEvent as project,
  creditGrantsFor,
  entitlementTransition,
  expireEntry,
  ignoredBecause,
  invoiceLinePlan,
  invoiceSubscriptionId,
  isActive,
  isCheckoutEvent,
  parseBillingEvent,
  planByLookupKey,
  planInvoiceLine,
  unixToIso,
  type BillingEvent,
  type BillingEventIgnoredReason,
  type BillingInvoiceObject,
  type BillingEventType,
  type CreditEntryDraft,
  type Entitlement,
  type EntitlementTransition,
  type SubscriptionPlan,
} from "@north/core";
import { creditBalance, getBillingEvent, getEntitlement, insertCreditEntries, isPurgeRunning, markBillingEventApplied, markBillingSessionCompleted, saveEntitlement } from "@north/db";
import type { WorkerDeps } from "../deps";
import { endSubscription, reactivate, type CompanyEvent } from "./entitlements";
import { notifyOwner } from "./notify";
import type { StepRunner } from "./steps";

/**
 * BIL-1 / BIL-2 (ADR 0014), `apply-billing-event` (one at a time per user):
 * `project` (the pure core projection on the stored, verified event; the
 * entitlement is written over the row it was read from, never a stale copy,
 * M6 review L10, and the event marked applied; a checkout event completes its
 * billing session), `credits` (the grants the event earns, and the old
 * period's `expire` when a plan invoice rolled it), `effects` (the kill
 * switch when it ended, the resume when it is active again, one notice when
 * payment failed; none for an event the projection ignored). Every write is
 * idempotent: refs on credits, the company's flag and reason on effects.
 */

type Snapshot = Pick<Entitlement, "status" | "planId" | "monthlyCredits" | "priceUsd" | "periodStart" | "stripeSubscriptionId" | "stripeCustomerId">;

type Projected =
  | { readonly applied: false; readonly reason: "applied" | "unknown user" | "ignored" | "purging" }
  | {
      readonly applied: true;
      readonly userId: string;
      readonly event: BillingEvent;
      readonly before: Snapshot;
      readonly after: Entitlement;
      readonly transition: EntitlementTransition;
      /** Why the projection left the entitlement as it was (`ignoredBecause`); null when it applied. */
      readonly ignored: BillingEventIgnoredReason | null;
    };

export interface AppliedBillingEvent {
  readonly billingEventId: string;
  readonly applied: boolean;
  readonly reason?: string;
  readonly userId?: string;
  readonly type?: BillingEventType;
  /** M6 review M1 / M3 / L13: the projection left the entitlement as it was, and why. */
  readonly ignored?: BillingEventIgnoredReason;
  readonly status?: Entitlement["status"];
  readonly transition: EntitlementTransition;
  /** Credit refs this event inserted (a replay inserts none). */
  readonly credits: readonly string[];
  /** `company/killswitch` or `company/resume` per company, for the function to send. */
  readonly events: readonly CompanyEvent[];
  readonly notified: boolean;
}

const snapshot = (e: Entitlement): Snapshot => ({ status: e.status, planId: e.planId, monthlyCredits: e.monthlyCredits, priceUsd: e.priceUsd, periodStart: e.periodStart, stripeSubscriptionId: e.stripeSubscriptionId, stripeCustomerId: e.stripeCustomerId });

async function projectStored(deps: WorkerDeps, billingEventId: string): Promise<Projected> {
  const record = await getBillingEvent(deps.db, billingEventId);
  if (!record) throw new Error(`billing event ${billingEventId} not found`);
  if (record.appliedAt !== null) return { applied: false, reason: "applied" };
  if (!record.userId) return { applied: false, reason: "unknown user" };
  const event = parseBillingEvent(record.payload);
  if ("ignored" in event) {
    await markBillingEventApplied(deps.db, billingEventId);
    return { applied: false, reason: "ignored" };
  }
  const before = await getEntitlement(deps.db, record.userId);
  if (!before) throw new Error(`entitlement of ${record.userId} not found`);
  const ignored = ignoredBecause(before, event);
  let after: Entitlement = before;
  try {
    if (ignored === null) after = await saveEntitlement(deps.db, before, project(before, event, deps.clock()));
  } catch (cause) {
    // M6 review M5: a purge is running and the database refuses the reactivation; the event stays unapplied.
    if (isPurgeRunning(cause)) return { applied: false, reason: "purging" };
    throw cause;
  }
  if (event.type === "checkout.session.completed") await markBillingSessionCompleted(deps.db, event.data.object.id);
  await markBillingEventApplied(deps.db, billingEventId);
  if (ignored !== null) console.warn(`[billing] ${event.type} ${event.id} left the entitlement of ${record.userId} as it was (${ignored})`);
  return { applied: true, userId: record.userId, event, before: snapshot(before), after, transition: entitlementTransition(before, after), ignored };
}

/** The invoice's own subscription as the provider reports it; null when it names no plan or the provider fails (logged). */
async function providerPlan(deps: WorkerDeps, object: BillingInvoiceObject, after: Entitlement): Promise<SubscriptionPlan | null> {
  const customer = object.customer ?? after.stripeCustomerId;
  const subscription = invoiceSubscriptionId(object);
  if (!customer || !subscription) return null;
  try {
    const found = await deps.integrations.billing.subscription(customer, subscription);
    return found?.lookupKey ? planByLookupKey(found.lookupKey) : null;
  } catch (cause) {
    console.warn(`[billing] plan of invoice ${object.id} from the provider failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

/**
 * The plan an invoice grant pays for, never a guess: the plan its own
 * subscription line names (`price.lookup_key`, API versions before 2025-03),
 * else that subscription as the provider reports it (a 2025-03 line carries
 * only the price id). When neither names one the step throws and Inngest
 * retries it; the entitlement's current plan (a trial's Solo, a plan the
 * projection has not caught up with) is never used. A grant whose step never
 * succeeds is healed by `entitlements-tick` (`healPlanGrants`).
 */
async function invoicePlan(deps: WorkerDeps, event: Extract<BillingEvent, { type: "invoice.paid" }>, after: Entitlement): Promise<Entitlement> {
  const object = event.data.object;
  const plan = invoiceLinePlan(object) ?? (await providerPlan(deps, object, after));
  if (!plan) throw new Error(`the plan of invoice ${object.id} is unknown: its subscription line names no lookup key and the provider named none; the step is retried`);
  return { ...after, planId: plan.id, monthlyCredits: plan.monthlyCredits };
}

/** The old period's unused plan credits expire when a plan invoice of the same subscription moves the period (never on the first invoice after a trial). */
async function periodRoll(deps: WorkerDeps, userId: string, event: Extract<BillingEvent, { type: "invoice.paid" }>, before: Snapshot): Promise<CreditEntryDraft | null> {
  const line = planInvoiceLine(event.data.object);
  if (!line || before.status === "trialing" || before.status === "ended") return null;
  if (before.stripeSubscriptionId === null || before.stripeSubscriptionId !== invoiceSubscriptionId(event.data.object)) return null;
  if (unixToIso(line.period.start) === before.periodStart) return null;
  return expireEntry({ periodStart: before.periodStart, balance: await creditBalance(deps.db, userId), planGrant: before.monthlyCredits });
}

/**
 * The grants are core's (`creditGrantsFor`: a plan invoice's subscription
 * line priced above zero, a paid pack at its price); a plan invoice of a
 * subscription the entitlement does not follow still earns its own period's
 * credits (money was received), but never rolls the followed period.
 */
async function grantCredits(deps: WorkerDeps, projected: Extract<Projected, { applied: true }>): Promise<readonly string[]> {
  const { event, after, before, userId } = projected;
  const drafts: CreditEntryDraft[] = [];
  if (event.type === "invoice.paid") {
    const expire = projected.ignored === null ? await periodRoll(deps, userId, event, before) : null;
    if (expire) drafts.push(expire);
    if (creditGrantsFor(event, after).length > 0) drafts.push(...creditGrantsFor(event, await invoicePlan(deps, event, after)));
  } else if (isCheckoutEvent(event)) drafts.push(...creditGrantsFor(event, after));
  return drafts.length > 0 ? insertCreditEntries(deps.db, userId, drafts) : [];
}

const SUBSCRIPTION_TYPES: ReadonlySet<BillingEventType> = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);

/**
 * The kill switch when the entitlement ended, the resume when it is active
 * again. A subscription event re-asserts the state even without a recorded
 * transition (a step that ran twice), both being idempotent on the
 * companies' flags; one `billing_past_due` notice on the way into past due.
 */
async function applyEffects(deps: WorkerDeps, projected: Extract<Projected, { applied: true }>, appUrl: string): Promise<{ readonly events: readonly CompanyEvent[]; readonly notified: boolean }> {
  const { after, transition, userId, event } = projected;
  if (projected.ignored !== null) return { events: [], notified: false };
  const asserted = SUBSCRIPTION_TYPES.has(event.type);
  if (after.status === "ended" && (transition === "ended" || asserted)) return { events: (await endSubscription(deps, userId)).events, notified: false };
  if (isActive(after) && (transition === "reactivated" || asserted)) {
    const revived = await reactivate(deps, userId);
    if (transition !== "past_due") return { events: revived.events, notified: false };
  }
  if (transition !== "past_due") return { events: [], notified: false };
  const sent = await notifyOwner(deps, userId, {
    kind: "billing_past_due",
    title: "North: a payment failed",
    body: "Stripe could not charge your card for North. Update the payment method in Manage billing; agents keep running until Stripe closes the subscription.",
    url: `${appUrl.replace(/\/$/, "")}/settings/billing`,
    payload: { billingEventType: event.type },
  });
  return { events: [], notified: sent.push > 0 || sent.email };
}

/** `apply-billing-event`: project → credits → effects, each a durable step; the function sends the returned events. */
export async function applyBillingEvent(deps: WorkerDeps, step: StepRunner, billingEventId: string, appUrl: string): Promise<AppliedBillingEvent> {
  const projected = await step.run("project", () => projectStored(deps, billingEventId));
  if (!projected.applied) return Object.freeze({ billingEventId, applied: false, reason: projected.reason, transition: null, credits: [], events: [], notified: false });
  const credits = await step.run("credits", () => grantCredits(deps, projected));
  const effects = await step.run("effects", () => applyEffects(deps, projected, appUrl));
  return Object.freeze({
    billingEventId,
    applied: true,
    userId: projected.userId,
    type: projected.event.type,
    ...(projected.ignored === null ? {} : { ignored: projected.ignored }),
    status: projected.after.status,
    transition: projected.transition,
    credits,
    events: effects.events,
    notified: effects.notified,
  });
}
