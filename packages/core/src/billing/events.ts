import { z } from "zod";
import { sanitizeText } from "../text";

/**
 * BIL-1 (ADR 0014): a Stripe webhook event is data. The worker verifies the
 * signature over the raw bytes, then this schema keeps only the fields the
 * projection reads from six event types; every string is bounded to 200
 * characters and passed through `sanitizeText`. Anything else is ignored,
 * never an error. The shapes follow Stripe's wire format (`items.data[0]`,
 * `lines.data[0]`) so live and sandbox bodies parse through one path.
 */
export const BILLING_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

/** Stripe's subscription statuses; the projection maps them onto `ENTITLEMENT_STATUSES`. */
export const STRIPE_SUBSCRIPTION_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;
export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

export const CHECKOUT_MODES = ["subscription", "payment", "setup"] as const;

const TEXT_MAX = 200;
const IGNORED_TYPE_MAX = 40;

const bounded = (value: string): string => sanitizeText(value).slice(0, TEXT_MAX);
const Text = z.string().transform(bounded);
const Id = Text.refine((value) => value.length > 0, { message: "id required" });
const NullableText = z
  .string()
  .nullable()
  .default(null)
  .transform((value) => (value === null ? null : bounded(value)));
/** Unix seconds, as Stripe sends timestamps. */
const Unix = z.number().int().nonnegative();
const NullableUnix = Unix.nullable().default(null);

/** The keys the worker writes on Stripe objects it creates; a user id must be a uuid or the event is refused. */
const Metadata = z.object({ north_user_id: z.uuid().optional(), north_pack_id: Text.optional() }).default({});

const CheckoutSessionObject = z.object({
  id: Id,
  customer: NullableText,
  client_reference_id: z.uuid().nullable().default(null),
  mode: z.enum(CHECKOUT_MODES),
  subscription: NullableText,
  metadata: Metadata,
});

const SubscriptionItem = z.object({
  price: z.object({ lookup_key: NullableText }).optional(),
  /** API versions from 2025-03 carry the period on the item instead of the subscription. */
  current_period_start: Unix.optional(),
  current_period_end: Unix.optional(),
});

const SubscriptionObject = z.object({
  id: Id,
  customer: NullableText,
  status: z.enum(STRIPE_SUBSCRIPTION_STATUSES),
  cancel_at_period_end: z.boolean().default(false),
  cancel_at: NullableUnix,
  current_period_start: Unix.optional(),
  current_period_end: Unix.optional(),
  items: z.object({ data: z.array(SubscriptionItem).max(20) }).default({ data: [] }),
  metadata: Metadata,
});

const InvoiceObject = z.object({
  id: Id,
  customer: NullableText,
  subscription: NullableText,
  amount_paid: z.number().int().nonnegative().default(0),
  lines: z.object({ data: z.array(z.object({ period: z.object({ start: Unix, end: Unix }) })).max(50) }).default({ data: [] }),
  metadata: Metadata,
  /** API versions from 2025-03 move the subscription id here. */
  parent: z
    .object({ subscription_details: z.object({ subscription: NullableText }).nullable().optional() })
    .nullable()
    .default(null),
});

const envelope = <T extends BillingEventType, O extends z.ZodTypeAny>(type: T, object: O) => z.object({ id: Id, type: z.literal(type), created: Unix, data: z.object({ object }) });

export const BillingEventSchema = z.discriminatedUnion("type", [
  envelope("checkout.session.completed", CheckoutSessionObject),
  envelope("customer.subscription.created", SubscriptionObject),
  envelope("customer.subscription.updated", SubscriptionObject),
  envelope("customer.subscription.deleted", SubscriptionObject),
  envelope("invoice.paid", InvoiceObject),
  envelope("invoice.payment_failed", InvoiceObject),
]);
export type BillingEvent = z.infer<typeof BillingEventSchema>;
export type BillingSubscriptionObject = z.infer<typeof SubscriptionObject>;
export type BillingInvoiceObject = z.infer<typeof InvoiceObject>;
export type BillingCheckoutObject = z.infer<typeof CheckoutSessionObject>;

export interface IgnoredBillingEvent {
  readonly ignored: string;
}

const isKnownType = (value: unknown): value is BillingEventType => typeof value === "string" && (BILLING_EVENT_TYPES as readonly string[]).includes(value);

/**
 * The webhook body as the projection reads it. An unknown or missing type is
 * `{ ignored }` (the route answers 200 and stores nothing); a known type with
 * a bad shape throws (400). The caller has already verified the signature.
 */
export function parseBillingEvent(json: unknown): BillingEvent | IgnoredBillingEvent {
  if (json === null || typeof json !== "object") return Object.freeze({ ignored: "unknown" });
  const type = (json as { readonly type?: unknown }).type;
  if (!isKnownType(type)) {
    const label = typeof type === "string" ? sanitizeText(type).slice(0, IGNORED_TYPE_MAX) : "";
    return Object.freeze({ ignored: label || "unknown" });
  }
  return BillingEventSchema.parse(json);
}

/** Unix seconds → ISO 8601 UTC. */
export const unixToIso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/** The Stripe customer the event belongs to; the route resolves the user from it. */
export function billingCustomerId(event: BillingEvent): string | null {
  return event.data.object.customer;
}

/** The user the worker tagged: `client_reference_id` on a checkout, else `metadata.north_user_id`. Must still exist as a user. */
export function billingUserHint(event: BillingEvent): string | null {
  const fromMetadata = event.data.object.metadata.north_user_id ?? null;
  return event.type === "checkout.session.completed" ? (event.data.object.client_reference_id ?? fromMetadata) : fromMetadata;
}

/** The subscription an invoice bills, across the two API shapes. */
export function invoiceSubscriptionId(object: BillingInvoiceObject): string | null {
  return object.subscription ?? object.parent?.subscription_details?.subscription ?? null;
}
