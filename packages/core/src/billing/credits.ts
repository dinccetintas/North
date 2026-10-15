import { z } from "zod";
import type { Entitlement } from "./entitlements";
import { invoiceSubscriptionId, unixToIso, type BillingEvent } from "./events";
import { CREDIT_PACKS, packById, SUBSCRIPTION_PLANS } from "./plans";

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
  /** Unique per user: `trial:<userId>`, `plan:<subscriptionId>:<periodStart>`, `pack:<sessionId>`, `run:<agentRunId>`, `expire:<periodStart>`. */
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

/** One credit per agent run, written in the step that records the run. */
export function consumeEntry(agentRunId: string): CreditEntryDraft {
  return draft("consume", -1, `run:${agentRunId}`);
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

function planGrantFor(event: Extract<BillingEvent, { type: "invoice.paid" }>, after: Entitlement): readonly CreditEntryDraft[] {
  const object = event.data.object;
  const subscriptionId = invoiceSubscriptionId(object) ?? after.stripeSubscriptionId;
  if (subscriptionId === null) return [];
  const line = object.lines.data[0];
  const periodStart = line ? unixToIso(line.period.start) : after.periodStart;
  return [draft("grant_plan", after.monthlyCredits, `plan:${subscriptionId}:${periodStart}`, `${SUBSCRIPTION_PLANS[after.planId].name} credits for the period`)];
}

function packGrantFor(event: Extract<BillingEvent, { type: "checkout.session.completed" }>): readonly CreditEntryDraft[] {
  const object = event.data.object;
  if (object.mode !== "payment") return [];
  const pack = packById(object.metadata.north_pack_id ?? CREDIT_PACKS[0]?.id ?? "");
  return pack ? [draft("grant_pack", pack.credits, `pack:${object.id}`, pack.id)] : [];
}

/**
 * The grants one event earns, each with the ref that makes a replay a no-op
 * (the insert ignores a conflict on `ref`): the plan's credits on
 * `invoice.paid` keyed by subscription and the invoice's own period, a pack on
 * a payment checkout keyed by the session. `after` is the entitlement the same
 * event produced.
 */
export function creditGrantsFor(event: BillingEvent, after: Entitlement): readonly CreditEntryDraft[] {
  switch (event.type) {
    case "invoice.paid":
      return Object.freeze(planGrantFor(event, after));
    case "checkout.session.completed":
      return Object.freeze(packGrantFor(event));
    default:
      return Object.freeze([]);
  }
}
