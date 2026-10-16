/**
 * BIL-1 / BIL-2 (ADR 0014): prices, limits and credits are configuration.
 * This file is the source of truth; `scripts/stripe-setup.ts` creates the
 * Stripe products and prices from it with lookup keys, and the worker resolves
 * a price by lookup key at checkout. No price id lives in code or in an
 * environment variable. The founder may change every number here.
 */
export const SUBSCRIPTION_PLAN_IDS = ["solo", "pro", "scale"] as const;
export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];

export interface SubscriptionPlan {
  readonly id: SubscriptionPlanId;
  readonly name: string;
  readonly priceUsd: number;
  readonly companyLimit: number;
  /** Agent runs included per period; one credit is one run. */
  readonly monthlyCredits: number;
  /** The Stripe price lookup key. */
  readonly lookupKey: string;
}

export const SUBSCRIPTION_PLANS: Readonly<Record<SubscriptionPlanId, SubscriptionPlan>> = Object.freeze({
  solo: Object.freeze({ id: "solo", name: "Solo", priceUsd: 99, companyLimit: 1, monthlyCredits: 300, lookupKey: "north_solo_monthly" }),
  pro: Object.freeze({ id: "pro", name: "Pro", priceUsd: 299, companyLimit: 3, monthlyCredits: 1000, lookupKey: "north_pro_monthly" }),
  scale: Object.freeze({ id: "scale", name: "Scale", priceUsd: 999, companyLimit: 10, monthlyCredits: 4000, lookupKey: "north_scale_monthly" }),
});

export interface CreditPack {
  readonly id: string;
  readonly credits: number;
  readonly priceUsd: number;
  readonly lookupKey: string;
}

/** One-off credit purchases (`payment`-mode checkout); pack credits never expire. */
export const CREDIT_PACKS: readonly CreditPack[] = Object.freeze([Object.freeze({ id: "pack_100", credits: 100, priceUsd: 29, lookupKey: "north_pack_100" })]);

/** Every new user gets Solo's limits and credits for this many days, no card. */
export const TRIAL_DAYS = 14;
/** RET-1: data stays this long after a subscription ends; the purge may run afterwards. */
export const RETENTION_DAYS = 90;
/** The database refuses a `consume` that would take the balance below `-CREDIT_GRACE`; concurrent runs cannot drain past it. */
export const CREDIT_GRACE = 5;
/** The spec's cost NFR: one `usage_alert` per period when inference plus sandbox cost crosses this share of the plan price. */
export const USAGE_ALERT_RATIO = 0.4;
/**
 * L10: a subscription checkout stays open this long (Stripe's `expires_at`,
 * whose minimum is 30 minutes); while one is open and not completed, a second
 * checkout of the same user is refused, so two clicks cannot buy two plans.
 */
export const CHECKOUT_OPEN_MINUTES = 35;
/** L2: a stored event no user owns (an unknown customer) is swept after this many days, Stripe's own event retention. */
export const UNKNOWN_BILLING_EVENT_DAYS = 30;
/** Sandbox compute per minute until the SDK runtime's real cost is known. */
export const SANDBOX_USD_PER_MINUTE = 0.01;

/** Every lookup key the platform sells; the billing adapters refuse any other. */
export const BILLING_LOOKUP_KEYS: readonly string[] = Object.freeze([...SUBSCRIPTION_PLAN_IDS.map((id) => SUBSCRIPTION_PLANS[id].lookupKey), ...CREDIT_PACKS.map((p) => p.lookupKey)]);

export function planByLookupKey(lookupKey: string): SubscriptionPlan | null {
  return SUBSCRIPTION_PLAN_IDS.map((id) => SUBSCRIPTION_PLANS[id]).find((plan) => plan.lookupKey === lookupKey) ?? null;
}

export function packById(id: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === id) ?? null;
}

/** A dollar price in Stripe's smallest unit (cents), the unit `amount_total` and `unit_amount` use. */
export const usdCents = (usd: number): number => Math.round(usd * 100);
