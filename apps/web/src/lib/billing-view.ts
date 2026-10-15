import { CREDIT_PACKS, SUBSCRIPTION_PLAN_IDS, SUBSCRIPTION_PLANS, type SubscriptionPlanId } from "@north/core/billing/plans";
import type { Entitlement, EntitlementStatus } from "@north/core/billing/entitlements";
import type { CreditEntryKind } from "@north/core/billing/credits";
import type { DispatchBlockReason } from "@north/core/billing/dispatch";
import { ENTITLEMENT_STATUS_LABELS, formatNumber, SUBSCRIPTION_PLAN_LABELS } from "./labels";

/**
 * BIL-1 / BIL-2 view models for `/settings/billing`. Pure: the loader reads
 * the rows under RLS (the web never holds a Stripe key and never changes an
 * entitlement), these functions shape them, the components render text.
 */

export type EntitlementLike = Pick<
  Entitlement,
  "planId" | "status" | "companyLimit" | "monthlyCredits" | "priceUsd" | "periodEnd" | "cancelAt" | "endedAt" | "retentionUntil" | "stripeSubscriptionId"
>;

const DAY_MS = 86_400_000;

/** Whole days until `iso`, rounded up; 0 when it passed or is not a date. */
export function daysLeft(iso: string, now: Date): number {
  const ms = Date.parse(iso) - now.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / DAY_MS) : 0;
}

const day = (iso: string | null): string | null => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const companiesWord = (n: number): string => `${n} ${n === 1 ? "company" : "companies"}`;

/** "1 of 3 companies": the owner's non-archived companies against the plan's limit. */
export function companiesLabel(count: number, limit: number): string {
  return `${count} of ${companiesWord(limit)}`;
}

function periodLabel(e: EntitlementLike, now: Date): string {
  switch (e.status) {
    case "trialing": {
      const left = daysLeft(e.periodEnd, now);
      return `Trial · ${left} ${left === 1 ? "day" : "days"} left`;
    }
    case "active":
      return `Renews on ${day(e.periodEnd) ?? "the period end"}`;
    case "canceled":
      return `Ends on ${day(e.cancelAt ?? e.periodEnd) ?? "the period end"}`;
    case "past_due":
      return "Payment failed · update your card in Manage billing";
    case "ended":
      return `Ended on ${day(e.endedAt) ?? "an earlier day"}`;
  }
}

export interface BillingSummary {
  readonly planId: SubscriptionPlanId;
  readonly planName: string;
  readonly status: EntitlementStatus;
  readonly statusLabel: string;
  readonly period: string;
  readonly companies: string;
  /** RET-1: the paused notice of an ended subscription; null otherwise. */
  readonly endedNotice: string | null;
  readonly retentionUntil: string | null;
}

export function billingSummary(e: EntitlementLike, companyCount: number, now: Date): BillingSummary {
  const retention = e.status === "ended" ? day(e.retentionUntil) : null;
  return Object.freeze({
    planId: e.planId,
    planName: SUBSCRIPTION_PLAN_LABELS[e.planId],
    status: e.status,
    statusLabel: ENTITLEMENT_STATUS_LABELS[e.status],
    period: periodLabel(e, now),
    companies: companiesLabel(companyCount, e.companyLimit),
    endedNotice: e.status === "ended" ? `Your agents are paused. Subscribe to resume; your data is kept until ${retention ?? "the retention date"}.` : null,
    retentionUntil: retention,
  });
}

/** `checkout` starts a subscription; a subscriber switches plans in the billing portal so no second subscription is ever created. */
export type PlanAction = "current" | "checkout" | "portal";

export interface PlanCardView {
  readonly id: SubscriptionPlanId;
  readonly name: string;
  readonly priceLabel: string;
  readonly companiesLabel: string;
  readonly creditsLabel: string;
  readonly current: boolean;
  readonly action: PlanAction;
  readonly actionLabel: string;
}

const SUBSCRIBED: ReadonlySet<EntitlementStatus> = new Set(["active", "canceled", "past_due"]);

/** A paid subscription is live (a trial has none; an ended one is gone). */
export function isSubscribed(e: Pick<EntitlementLike, "status" | "stripeSubscriptionId"> | null): boolean {
  return e !== null && SUBSCRIBED.has(e.status) && e.stripeSubscriptionId !== null;
}

function planAction(id: SubscriptionPlanId, e: EntitlementLike | null): PlanAction {
  if (!isSubscribed(e)) return "checkout";
  return e?.planId === id ? "current" : "portal";
}

const ACTION_LABEL = (action: PlanAction, name: string): string => (action === "current" ? "Current" : action === "portal" ? "Switch in billing" : `Choose ${name}`);

export function planCards(e: EntitlementLike | null): readonly PlanCardView[] {
  return Object.freeze(
    SUBSCRIPTION_PLAN_IDS.map((id) => {
      const plan = SUBSCRIPTION_PLANS[id];
      const action = planAction(id, e);
      return Object.freeze({
        id,
        name: plan.name,
        priceLabel: `$${formatNumber(plan.priceUsd)} / month`,
        companiesLabel: companiesWord(plan.companyLimit),
        creditsLabel: `${formatNumber(plan.monthlyCredits)} runs a month`,
        current: action === "current",
        action,
        actionLabel: ACTION_LABEL(action, plan.name),
      });
    }),
  );
}

export interface PackCardView {
  readonly id: string;
  readonly label: string;
  readonly priceLabel: string;
}

export function packCards(): readonly PackCardView[] {
  return Object.freeze(CREDIT_PACKS.map((p) => Object.freeze({ id: p.id, label: `${formatNumber(p.credits)} credits`, priceLabel: `$${formatNumber(p.priceUsd)}` })));
}

export const CREDIT_KIND_LABELS: Readonly<Record<CreditEntryKind, string>> = Object.freeze({
  grant_plan: "Plan credits",
  grant_pack: "Credit pack",
  consume: "Agent run",
  expire: "Expired",
  adjust: "Adjustment",
});

export interface CreditEntryLike {
  readonly id: string;
  readonly kind: CreditEntryKind;
  readonly amount: number;
  readonly ref: string;
  readonly note: string;
  readonly createdAt: string;
}

export interface CreditEntryRow {
  readonly id: string;
  readonly kind: CreditEntryKind;
  readonly kindLabel: string;
  readonly amountLabel: string;
  readonly note: string;
  readonly day: string;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

export function creditEntryRows(entries: readonly CreditEntryLike[]): readonly CreditEntryRow[] {
  return Object.freeze(entries.map((e) => Object.freeze({ id: e.id, kind: e.kind, kindLabel: CREDIT_KIND_LABELS[e.kind], amountLabel: signed(e.amount), note: e.note, day: day(e.createdAt) ?? "" })));
}

export interface BillingSessionLike {
  readonly kind: "checkout" | "portal" | "credit_pack";
  readonly planId: string | null;
  /** The provider's session id the worker wrote; a pack's grant is `pack:<providerRef>`. */
  readonly providerRef: string | null;
}

/**
 * The success redirect proves nothing (ADR 0014): a checkout is confirmed
 * when the webhook-projected entitlement is the plan the session asked for
 * with a live subscription; a credit pack when its grant is in the ledger.
 * Without a known session, any live subscription counts.
 */
export function checkoutConfirmed(session: BillingSessionLike | null, e: EntitlementLike | null, creditRefs: readonly string[]): boolean {
  if (session?.kind === "credit_pack") return session.providerRef !== null && creditRefs.includes(`pack:${session.providerRef}`);
  if (!isSubscribed(e)) return false;
  return session === null || session.planId === null || e?.planId === session.planId;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The worker's session URL is followed only when it is https (Stripe) or the sandbox's loopback http; never credentials, never another scheme. */
export function safeRedirectUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username !== "" || url.password !== "") return null;
    if (url.protocol === "https:") return url.href;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/** A queued task shows the company's dispatch refusal; the kill switch is explained by its own bar, so it is not repeated per row. */
export function queuedBlockReason(taskStatus: string, block: DispatchBlockReason | null): DispatchBlockReason | null {
  if (taskStatus !== "queued" || block === null || block === "kill_switch") return null;
  return block;
}
