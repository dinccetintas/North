import { z } from "zod";
import { BILLING_LOOKUP_KEYS, CREDIT_PACKS, packById, planByLookupKey, type CreditPack, type StripeSubscriptionStatus } from "@north/core";

/**
 * BIL-1 / BIL-2 (ADR 0014): the platform's own Stripe account, where North is
 * the merchant for its subscription and credit packs. Unlike the user-owned
 * providers this is not a factory: the worker holds the platform keys and the
 * user's Stripe (OUT-2) stays the read-only `payments` connection. Every
 * input is validated here, before either adapter sees it; the only lookup
 * keys accepted are the ones `packages/core/src/billing/plans.ts` sells.
 */

/** `setup` exists in Stripe but North never sells through it. */
export const BILLING_CHECKOUT_MODES = ["subscription", "payment"] as const;
export type BillingCheckoutMode = (typeof BILLING_CHECKOUT_MODES)[number];

const URL_MAX = 2048;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where Stripe may send the user back: https anywhere, or plain http on a
 * loopback host (the app's own origin in development). No credentials in the
 * URL. The string is passed on untouched (Stripe's `{CHECKOUT_SESSION_ID}`
 * template must survive), so this only inspects it.
 */
export function isAllowedBillingUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
}

const BillingUrl = z.string().max(URL_MAX).refine(isAllowedBillingUrl, { message: "billing URLs must be https, or http on the app's loopback origin" });

/** Stripe customer ids (`cus_…`, `cus_sandbox_<n>`); the strict shape also keeps them safe as a path segment. */
export const CustomerIdSchema = z.string().regex(/^cus_[A-Za-z0-9_]{1,120}$/, "a Stripe customer id (cus_…)");
/** Stripe subscription ids (`sub_…`, `sub_sandbox_<n>`); safe as a path segment for the same reason. */
export const SubscriptionIdSchema = z.string().regex(/^sub_[A-Za-z0-9_]{1,120}$/, "a Stripe subscription id (sub_…)");

/** The `billing_sessions` row id in practice; Stripe accepts up to 255 characters. */
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9:._-]{1,255}$/, "idempotency key: letters, digits, ':', '.', '_' or '-'");

const isSellable = (key: string): boolean => BILLING_LOOKUP_KEYS.includes(key);
const LookupKey = z.string().refine(isSellable, { message: "lookup key is not one North sells (packages/core billing/plans.ts)" });

/** The credit pack a payment lookup key belongs to; null for a plan key or anything else. */
export function packForLookupKey(lookupKey: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.lookupKey === lookupKey) ?? null;
}

export const EnsureCustomerInputSchema = z.object({ userId: z.uuid(), email: z.email().max(254) });
export type EnsureCustomerInput = z.input<typeof EnsureCustomerInputSchema>;

const modeMatchesKey = (input: { readonly mode: BillingCheckoutMode; readonly lookupKey: string }): boolean =>
  input.mode === "subscription" ? planByLookupKey(input.lookupKey) !== null : packForLookupKey(input.lookupKey) !== null;

/** A subscription checkout sells a plan, a payment checkout sells a pack; the key must match the mode. */
export const CheckoutSessionInputSchema = z
  .object({
    customerId: CustomerIdSchema,
    lookupKey: LookupKey,
    mode: z.enum(BILLING_CHECKOUT_MODES).default("subscription"),
    /** The user id; Stripe echoes it on `checkout.session.completed` (core `billingUserHint`). */
    clientReferenceId: z.uuid(),
    successUrl: BillingUrl,
    cancelUrl: BillingUrl,
    idempotencyKey: IdempotencyKey,
  })
  .refine(modeMatchesKey, { message: "subscription mode takes a plan lookup key, payment mode a credit pack lookup key", path: ["lookupKey"] });
export type CheckoutSessionInput = z.input<typeof CheckoutSessionInputSchema>;
export type ParsedCheckoutSessionInput = z.output<typeof CheckoutSessionInputSchema>;

/** One-off credits: the pack id from core (`pack_100`); the adapters set `metadata.north_pack_id` from it. */
export const CreditPackSessionInputSchema = z.object({
  customerId: CustomerIdSchema,
  packId: z.string().refine((id) => packById(id) !== null, { message: "unknown credit pack (packages/core billing/plans.ts)" }),
  clientReferenceId: z.uuid(),
  successUrl: BillingUrl,
  cancelUrl: BillingUrl,
  idempotencyKey: IdempotencyKey,
});
export type CreditPackSessionInput = z.input<typeof CreditPackSessionInputSchema>;

export const PortalSessionInputSchema = z.object({
  customerId: CustomerIdSchema,
  returnUrl: BillingUrl,
  idempotencyKey: IdempotencyKey.optional(),
});
export type PortalSessionInput = z.input<typeof PortalSessionInputSchema>;

export interface EnsureCustomerResult {
  readonly customerId: string;
  readonly sandbox: boolean;
}

/** A hosted page the user is redirected to; `providerRef` is the Stripe session id (`cs_…`, `bps_…`). */
export interface BillingSessionResult {
  readonly url: string;
  readonly providerRef: string;
  readonly sandbox: boolean;
}

/** The customer's latest subscription as the provider reports it; informative only (entitlements move through the webhook). */
export interface BillingSubscription {
  readonly id: string;
  readonly status: StripeSubscriptionStatus;
  readonly lookupKey: string | null;
  /** ISO 8601; null when the provider did not say. */
  readonly periodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly sandbox: boolean;
}

/**
 * The platform's billing provider. Sessions only start a flow; nothing here
 * changes an entitlement (the signed webhook is the only path that does, in
 * sandbox and live alike).
 */
export interface BillingProvider {
  /** Idempotent per user: the existing customer tagged `metadata.north_user_id`, else a new one. */
  ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<BillingSessionResult>;
  /** A `payment`-mode checkout for one credit pack. */
  createCreditPackSession(input: CreditPackSessionInput): Promise<BillingSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<BillingSessionResult>;
  /**
   * The customer's newest subscription in any status, or, with
   * `subscriptionId`, that one subscription of the customer (`entitlements-tick`
   * asks whether the followed one has ended, M6 review M1). Null when there is
   * none, when the id is malformed, or when it belongs to another customer.
   */
  subscription(customerId: string, subscriptionId?: string): Promise<BillingSubscription | null>;
}
