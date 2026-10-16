import { z } from "zod";
import type { Entitlement } from "./entitlements";
import { invoiceSubscriptionId, isCheckoutEvent, planInvoiceLine, unixToIso, type BillingEvent, type CheckoutEvent } from "./events";
import { packById, SUBSCRIPTION_PLANS, usdCents } from "./plans";

/**
 * BIL-2 (ADR 0014): credits are an append-only ledger; the balance is a sum
 * and nothing decrements in place. One credit is one agent run, any role, any
 * runtime. The worker writes the rows; this module drafts them and sums them.
 */
export const CREDIT_ENTRY_KINDS = ["grant_plan", "grant_pack", "consume", "expire", "adjust"] as const;
export type CreditEntryKind = (typeof CREDIT_ENTRY_KINDS)[number];

const REF_MAX = 200;
const NOTE_MAX = 500;

/** Grants add, consumes and expiries take, an adjustment is a signed manual row. */
function signMatches(kind: CreditEntryKind, amount: number): boolean {
  switch (kind) {
    case "grant_plan":
    case "grant_pack":
      return amount > 0;
    case "consume":
    case "expire":
      return amount < 0;
    case "adjust":
      return amount !== 0;
  }
}

const sign = { message: "amount sign does not match the kind", path: ["amount"] };

const Draft = z.object({
  kind: z.enum(CREDIT_ENTRY_KINDS),
  amount: z.number().int(),
  /** Unique per user: `trial:<userId>`, `plan:<subscriptionId>:<periodStart>`, `pack:<sessionId>`, `run:<agentRunId>` (reserved at dispatch, L9), `release:<agentRunId>`, `expire:<periodStart>`. */
  ref: z.string().min(1).max(REF_MAX),
  note: z.string().max(NOTE_MAX).default(""),
});

export const CreditEntryDraftSchema = Draft.refine((entry) => signMatches(entry.kind, entry.amount), sign);
export type CreditEntryDraft = z.infer<typeof CreditEntryDraftSchema>;

export const CreditEntrySchema = Draft.extend({ id: z.uuid(), userId: z.uuid(), createdAt: z.iso.datetime({ offset: true }) }).refine((entry) => signMatches(entry.kind, entry.amount), sign);
export type CreditEntry = z.infer<typeof CreditEntrySchema>;

const draft = (kind: CreditEntryKind, amount: number, ref: string, note = ""): CreditEntryDraft => Object.freeze({ kind, amount, ref, note });

/** The balance is the sum of the ledger; the database's `credit_balance(user_id)` computes the same. */
export function creditBalance(entries: readonly Pick<CreditEntryDraft, "amount">[]): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

/** Dispatch refuses at a balance of zero or below; the database's grace of `CREDIT_GRACE` is for concurrent runs only. */
export function canDispatch(balance: number): boolean {
  return balance > 0;
}

/** The trial's Solo credits, once per user. */
export function trialGrant(userId: string): CreditEntryDraft {
  return draft("grant_plan", SUBSCRIPTION_PLANS.solo.monthlyCredits, `trial:${userId}`, "Solo trial");
}

/** One credit per agent run, reserved at dispatch before the run starts (L9: `credit_reserve`), keyed by the run's id. */
export function consumeEntry(agentRunId: string): CreditEntryDraft {
  return draft("consume", -1, `run:${agentRunId}`);
}

/** L9: a reserved run that never started (the runtime threw, the task changed under it) gets its credit back; one release per run. */
export function releaseEntry(agentRunId: string): CreditEntryDraft {
  return draft("adjust", 1, `release:${agentRunId}`, "the run did not start; its reserved credit is released");
}

/**
 * The period roll: unused plan credits expire, pack credits never do. Plan
 * credits are spent first, so what is left of the plan grant is
 * `min(balance, planGrant)`; null when nothing is left to expire.
 */
export function expireEntry(input: { readonly periodStart: string; readonly balance: number; readonly planGrant: number }): CreditEntryDraft | null {
  const unused = Math.max(0, Math.min(input.balance, input.planGrant));
  return unused === 0 ? null : draft("expire", -unused, `expire:${input.periodStart}`, "unused plan credits of the period");
}

/**
 * M3: the plan's credits for one plan period, only on the invoice that pays
 * for it (`planInvoiceLine`: `subscription_create` or `subscription_cycle`,
 * the subscription line, never a proration), keyed by that line's period.
 * Decision (M6 review): the line must bill a price above zero, so a $0 line
 * (a Stripe trial, a free price) grants nothing; `amount_paid` itself may be 0
 * when a coupon the founder issued, the customer's balance or a proration
 * credit (the user's own earlier payment) paid for the period.
 */
function planGrantFor(event: Extract<BillingEvent, { type: "invoice.paid" }>, after: Entitlement): readonly CreditEntryDraft[] {
  const object = event.data.object;
  const subscriptionId = invoiceSubscriptionId(object);
  const line = planInvoiceLine(object);
  if (subscriptionId === null || line === null || line.amount <= 0) return [];
  return [draft("grant_plan", after.monthlyCredits, planGrantRef(subscriptionId, unixToIso(line.period.start)), `${SUBSCRIPTION_PLANS[after.planId].name} credits for the period`)];
}

/** The one ref of a plan period's grant: the invoice's grant and the tick's heal write the same row, so whichever comes second writes nothing. */
export const planGrantRef = (subscriptionId: string, periodStart: string): string => `plan:${subscriptionId}:${periodStart}`;

/**
 * `entitlements-tick`'s heal: the grant the current period's `invoice.paid`
 * should have written (its credits step may have failed for good after the
 * event was marked applied), from the entitlement's own plan and period.
 * Null without a paid subscription (a trial, a $0 price).
 */
export function periodPlanGrant(entitlement: Entitlement): CreditEntryDraft | null {
  if (entitlement.stripeSubscriptionId === null || entitlement.priceUsd <= 0 || entitlement.monthlyCredits <= 0) return null;
  return draft("grant_plan", entitlement.monthlyCredits, planGrantRef(entitlement.stripeSubscriptionId, entitlement.periodStart), `${SUBSCRIPTION_PLANS[entitlement.planId].name} credits for the period`);
}

/**
 * H1: a pack only for money received: a payment checkout whose
 * `payment_status` is `paid` (a delayed method completes `unpaid` and is
 * granted on `checkout.session.async_payment_succeeded`, the same session and
 * so the same ref), tagged with a pack North sells, for exactly that pack's
 * price in usd. Nothing falls back to a default pack.
 */
function packGrantFor(event: CheckoutEvent): readonly CreditEntryDraft[] {
  const object = event.data.object;
  if (object.mode !== "payment" || object.payment_status !== "paid") return [];
  const pack = object.metadata.north_pack_id ? packById(object.metadata.north_pack_id) : null;
  if (pack === null || object.currency !== "usd" || object.amount_total !== usdCents(pack.priceUsd)) return [];
  return [draft("grant_pack", pack.credits, `pack:${object.id}`, pack.id)];
}

/**
 * The grants one event earns, each with the ref that makes a replay a no-op
 * (the insert ignores a conflict on `ref`): the plan's credits on a plan
 * invoice keyed by subscription and the plan line's period, a pack on a paid
 * payment checkout keyed by the session. `after` is the entitlement the same
 * event produced (it names the plan).
 */
export function creditGrantsFor(event: BillingEvent, after: Entitlement): readonly CreditEntryDraft[] {
  if (event.type === "invoice.paid") return Object.freeze(planGrantFor(event, after));
  if (isCheckoutEvent(event)) return Object.freeze(packGrantFor(event));
  return Object.freeze([]);
}
