import {
  applyBillingEvent as project,
  creditGrantsFor,
  entitlementTransition,
  expireEntry,
  invoiceSubscriptionId,
  isActive,
  parseBillingEvent,
  planByLookupKey,
  unixToIso,
  type BillingEvent,
  type BillingEventType,
  type CreditEntryDraft,
  type Entitlement,
  type EntitlementTransition,
} from "@north/core";
import { creditBalance, getBillingEvent, getEntitlement, insertCreditEntries, markBillingEventApplied, upsertEntitlement } from "@north/db";
import type { WorkerDeps } from "../deps";
import { endSubscription, reactivate, type CompanyEvent } from "./entitlements";
import { notifyOwner } from "./notify";
import type { StepRunner } from "./steps";

/**
 * BIL-1 / BIL-2 (ADR 0014), `apply-billing-event` (one at a time per user):
 * `project` (the pure core projection on the stored, verified event; the
 * entitlement is upserted and the event marked applied), `credits` (the
 * grants the event earns, and the old period's `expire` when an invoice
 * rolled it), `effects` (the kill switch when it ended, the resume when it
 * is active again, one notice when payment failed). Every write is
 * idempotent: refs on credits, the company's flag and reason on effects.
 */

type Snapshot = Pick<Entitlement, "status" | "planId" | "monthlyCredits" | "priceUsd" | "periodStart" | "stripeSubscriptionId" | "stripeCustomerId">;

type Projected =
  | { readonly applied: false; readonly reason: "applied" | "unknown user" | "ignored" }
  | { readonly applied: true; readonly userId: string; readonly event: BillingEvent; readonly before: Snapshot; readonly after: Entitlement; readonly transition: EntitlementTransition };

export interface AppliedBillingEvent {
  readonly billingEventId: string;
  readonly applied: boolean;
  readonly reason?: string;
  readonly userId?: string;
  readonly type?: BillingEventType;
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
  const after = await upsertEntitlement(deps.db, project(before, event, deps.clock()));
  await markBillingEventApplied(deps.db, billingEventId);
  return { applied: true, userId: record.userId, event, before: snapshot(before), after, transition: entitlementTransition(before, after) };
}

/**
 * The plan an invoice pays for. Stripe does not order `invoice.paid` after
 * `customer.subscription.created`: while the projection has not seen the
 * invoice's subscription yet (trial fields, an ended entitlement, another
 * subscription), the provider's current subscription names the plan.
 */
async function invoicePlan(deps: WorkerDeps, event: Extract<BillingEvent, { type: "invoice.paid" }>, after: Entitlement): Promise<Entitlement> {
  const settled = after.priceUsd > 0 && after.status !== "ended" && after.stripeSubscriptionId === invoiceSubscriptionId(event.data.object);
  const customer = event.data.object.customer ?? after.stripeCustomerId;
  if (settled || !customer) return after;
  try {
    const current = await deps.integrations.billing.subscription(customer);
    const plan = current?.lookupKey ? planByLookupKey(current.lookupKey) : null;
    return plan ? { ...after, planId: plan.id, monthlyCredits: plan.monthlyCredits } : after;
  } catch (cause) {
    console.warn(`[billing] plan of invoice ${event.data.object.id} from the provider failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return after;
  }
}

/** The old period's unused plan credits expire when a paid invoice of the same subscription moves the period (never on the first invoice after a trial). */
async function periodRoll(deps: WorkerDeps, userId: string, event: Extract<BillingEvent, { type: "invoice.paid" }>, before: Snapshot): Promise<CreditEntryDraft | null> {
  const line = event.data.object.lines.data[0];
  if (!line || before.status === "trialing" || before.status === "ended") return null;
  if (before.stripeSubscriptionId === null || before.stripeSubscriptionId !== invoiceSubscriptionId(event.data.object)) return null;
  if (unixToIso(line.period.start) === before.periodStart) return null;
  return expireEntry({ periodStart: before.periodStart, balance: await creditBalance(deps.db, userId), planGrant: before.monthlyCredits });
}

async function grantCredits(deps: WorkerDeps, projected: Extract<Projected, { applied: true }>): Promise<readonly string[]> {
  const { event, after, before, userId } = projected;
  const drafts: CreditEntryDraft[] = [];
  if (event.type === "invoice.paid") {
    const expire = await periodRoll(deps, userId, event, before);
    if (expire) drafts.push(expire);
    drafts.push(...creditGrantsFor(event, await invoicePlan(deps, event, after)));
  } else drafts.push(...creditGrantsFor(event, after));
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
  return Object.freeze({ billingEventId, applied: true, userId: projected.userId, type: projected.event.type, status: projected.after.status, transition: projected.transition, credits, events: effects.events, notified: effects.notified });
}
