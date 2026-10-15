import { createHmac } from "node:crypto";
import { planByLookupKey, type BillingEventType } from "@north/core";
import { packForLookupKey } from "../billing-types";
import type { SandboxCheckoutSession, SandboxStripeEvent, SandboxSubscription } from "./billing-store";

/**
 * Pure builders for the Stripe-shaped bodies the sandbox posts to the
 * worker's own `/webhooks/stripe`. They follow the 2025-03 ("basil") wire
 * format: the period lives on `items.data[0]`, an invoice names its
 * subscription under `parent.subscription_details`, lists are
 * `{ object: "list", data, has_more }`. Core's `parseBillingEvent` keeps only
 * what the projection reads; the rest is here so the bodies look like what
 * Stripe sends and the webhook is exercised on realistic input.
 */
export const SANDBOX_STRIPE_API_VERSION = "2025-03-31.basil";

/** The webhook secret the sandbox signs with and the worker accepts on loopback when `STRIPE_WEBHOOK_SECRET` is unset (M6 scope decisions). */
export const SANDBOX_STRIPE_WEBHOOK_SECRET = "whsec_sandbox";

const CURRENCY = "usd";
type StripeObject = Readonly<Record<string, unknown>>;

/** Price in cents of a plan or pack lookup key (0 for an unknown key, which the input schemas already refuse). */
export function priceCents(lookupKey: string): number {
  const usd = planByLookupKey(lookupKey)?.priceUsd ?? packForLookupKey(lookupKey)?.priceUsd ?? 0;
  return Math.round(usd * 100);
}

/** `anchor` plus `months` calendar months in UTC, clamped to the month's last day (Stripe's billing cycle anchor rule). */
export function addMonths(anchor: number, months: number): number {
  const date = new Date(anchor * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return Math.floor(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()) / 1000);
}

export interface Period {
  readonly start: number;
  readonly end: number;
}

export function periodOf(subscription: Pick<SandboxSubscription, "anchor">, cycle: number): Period {
  return Object.freeze({ start: addMonths(subscription.anchor, cycle), end: addMonths(subscription.anchor, cycle + 1) });
}

export function stripeEvent(id: string, created: number, type: BillingEventType, object: StripeObject, previous?: StripeObject): SandboxStripeEvent {
  return Object.freeze({
    id,
    object: "event",
    api_version: SANDBOX_STRIPE_API_VERSION,
    created,
    livemode: false,
    pending_webhooks: 1,
    request: Object.freeze({ id: null, idempotency_key: null }),
    type,
    data: Object.freeze({ object, ...(previous ? { previous_attributes: previous } : {}) }),
  });
}

function priceObject(lookupKey: string): StripeObject {
  const recurring = planByLookupKey(lookupKey) !== null;
  return {
    id: `price_sandbox_${lookupKey}`,
    object: "price",
    active: true,
    currency: CURRENCY,
    livemode: false,
    lookup_key: lookupKey,
    product: `prod_sandbox_${lookupKey}`,
    type: recurring ? "recurring" : "one_time",
    recurring: recurring ? { interval: "month", interval_count: 1 } : null,
    unit_amount: priceCents(lookupKey),
  };
}

export function checkoutSessionObject(session: SandboxCheckoutSession, refs: { readonly subscriptionId: string | null; readonly paymentIntentId: string | null }): StripeObject {
  const cents = priceCents(session.lookupKey);
  return {
    id: session.id,
    object: "checkout.session",
    mode: session.mode,
    status: "complete",
    payment_status: "paid",
    customer: session.customerId,
    client_reference_id: session.clientReferenceId,
    subscription: refs.subscriptionId,
    payment_intent: refs.paymentIntentId,
    amount_subtotal: cents,
    amount_total: cents,
    currency: CURRENCY,
    created: session.created,
    livemode: false,
    success_url: session.successUrl,
    cancel_url: session.cancelUrl,
    url: null,
    metadata: { north_user_id: session.clientReferenceId, ...(session.packId ? { north_pack_id: session.packId } : {}) },
  };
}

export function subscriptionObject(subscription: SandboxSubscription): StripeObject {
  const period = periodOf(subscription, subscription.cycle);
  return {
    id: subscription.id,
    object: "subscription",
    customer: subscription.customerId,
    status: subscription.status,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    cancel_at: subscription.cancelAt,
    canceled_at: subscription.canceledAt,
    ended_at: subscription.endedAt,
    created: subscription.anchor,
    start_date: subscription.anchor,
    billing_cycle_anchor: subscription.anchor,
    collection_method: "charge_automatically",
    currency: CURRENCY,
    livemode: false,
    items: {
      object: "list",
      data: [{ id: subscription.itemId, object: "subscription_item", subscription: subscription.id, quantity: 1, created: subscription.anchor, current_period_start: period.start, current_period_end: period.end, price: priceObject(subscription.lookupKey) }],
      has_more: false,
      total_count: 1,
      url: `/v1/subscription_items?subscription=${subscription.id}`,
    },
    metadata: { north_user_id: subscription.userId },
  };
}

export interface InvoiceInput {
  readonly id: string;
  readonly lineId: string;
  readonly subscription: SandboxSubscription;
  readonly period: Period;
  readonly paid: boolean;
  readonly attempt: number;
  readonly billingReason: "subscription_create" | "subscription_cycle";
  readonly created: number;
}

function invoiceLine(input: InvoiceInput, cents: number): StripeObject {
  const plan = planByLookupKey(input.subscription.lookupKey);
  return {
    id: input.lineId,
    object: "line_item",
    amount: cents,
    currency: CURRENCY,
    description: `1 × North ${plan?.name ?? input.subscription.lookupKey} (at $${cents / 100} / month)`,
    quantity: 1,
    period: { start: input.period.start, end: input.period.end },
    parent: { type: "subscription_item_details", subscription_item_details: { subscription: input.subscription.id, subscription_item: input.subscription.itemId, proration: false } },
    pricing: { type: "price_details", price_details: { price: `price_sandbox_${input.subscription.lookupKey}`, product: `prod_sandbox_${input.subscription.lookupKey}` }, unit_amount_decimal: String(cents) },
  };
}

export function invoiceObject(input: InvoiceInput): StripeObject {
  const cents = priceCents(input.subscription.lookupKey);
  return {
    id: input.id,
    object: "invoice",
    customer: input.subscription.customerId,
    status: input.paid ? "paid" : "open",
    amount_due: cents,
    amount_paid: input.paid ? cents : 0,
    amount_remaining: input.paid ? 0 : cents,
    attempt_count: input.attempt,
    attempted: true,
    billing_reason: input.billingReason,
    collection_method: "charge_automatically",
    currency: CURRENCY,
    created: input.created,
    livemode: false,
    lines: { object: "list", data: [invoiceLine(input, cents)], has_more: false, total_count: 1, url: `/v1/invoices/${input.id}/lines` },
    parent: { type: "subscription_details", subscription_details: { subscription: input.subscription.id, metadata: { north_user_id: input.subscription.userId } }, quote_details: null },
    status_transitions: { paid_at: input.paid ? input.created : null },
    metadata: {},
  };
}

/**
 * Stripe's `stripe-signature` header for `body`: `t=<unix>,v1=<hex>` where
 * v1 is HMAC-SHA256 of `"<t>.<body>"` keyed with the whole endpoint secret
 * (`whsec_…`). The worker verifies it exactly as it verifies Stripe's own.
 */
export function signSandboxWebhook(body: string, secret: string, now: Date): string {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

export interface SignedSandboxEvent {
  readonly eventId: string;
  /** The exact bytes to POST; the signature covers these and nothing else. */
  readonly body: string;
  /** The `stripe-signature` header value. */
  readonly signature: string;
}

/** Serialises one event once and signs those bytes: what a sandbox page POSTs to `/webhooks/stripe`. */
export function signedSandboxEvent(event: SandboxStripeEvent, secret: string, now: Date): SignedSandboxEvent {
  const body = JSON.stringify(event);
  return Object.freeze({ eventId: event.id, body, signature: signSandboxWebhook(body, secret, now) });
}
