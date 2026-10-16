import { CHECKOUT_OPEN_MINUTES, packById, STRIPE_SUBSCRIPTION_STATUSES } from "@north/core";
import { z } from "zod";
import {
  CheckoutSessionInputSchema,
  CreditPackSessionInputSchema,
  CustomerIdSchema,
  EnsureCustomerInputSchema,
  PortalSessionInputSchema,
  SubscriptionIdSchema,
  packForLookupKey,
  type BillingProvider,
  type BillingSessionResult,
  type BillingSubscription,
  type CheckoutSessionInput,
  type CreditPackSessionInput,
  type EnsureCustomerInput,
  type EnsureCustomerResult,
  type ParsedCheckoutSessionInput,
  type PortalSessionInput,
} from "../billing-types";
import { BillingProviderError } from "../errors";
import type { FetchLike } from "./github";
import { stripeCall, type StripeRequest } from "./stripe-http";

export { STRIPE_API, stripeForm, type FormValue } from "./stripe-http";

/** The platform's Stripe keys (worker secrets on the CI grep list); the founder enters them, test mode first (CLAUDE.md #5). */
export interface StripeBillingConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
}

/** Both keys or nothing: without the webhook secret no entitlement could ever move, so a half configuration stays in sandbox. */
export function stripeBillingConfig(env: NodeJS.ProcessEnv = process.env): StripeBillingConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  return secretKey && webhookSecret ? Object.freeze({ secretKey, webhookSecret }) : null;
}

const HttpsUrl = z.url().refine((value) => value.startsWith("https://"));
const ListOf = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item) });
const CustomerList = ListOf(z.object({ id: CustomerIdSchema }));
const Customer = z.object({ id: CustomerIdSchema });
const PriceList = ListOf(z.object({ id: z.string().regex(/^price_[A-Za-z0-9_]{1,200}$/) }));
const HostedSession = z.object({ id: z.string().regex(/^(cs|bps)_[A-Za-z0-9_]{1,200}$/), url: HttpsUrl });
const SubscriptionObject = z.object({
  id: z.string().min(1).max(200),
  customer: z.string().max(200).nullable().default(null),
  status: z.enum(STRIPE_SUBSCRIPTION_STATUSES),
  cancel_at_period_end: z.boolean().default(false),
  current_period_end: z.number().int().optional(),
  items: z.object({ data: z.array(z.object({ price: z.object({ lookup_key: z.string().max(200).nullable().default(null) }).optional(), current_period_end: z.number().int().optional() })) }).default({ data: [] }),
});
const SubscriptionList = ListOf(SubscriptionObject);

/** The period end from the subscription or, on 2025-03+ API versions, its first item. */
function toSubscription(raw: z.output<typeof SubscriptionObject>): BillingSubscription {
  const item = raw.items.data[0];
  const periodEnd = raw.current_period_end ?? item?.current_period_end;
  return Object.freeze({
    id: raw.id,
    status: raw.status,
    lookupKey: item?.price?.lookup_key ?? null,
    periodEnd: periodEnd === undefined ? null : new Date(periodEnd * 1000).toISOString(),
    cancelAtPeriodEnd: raw.cancel_at_period_end,
    sandbox: false,
  });
}

/**
 * The platform's Stripe Billing over raw `fetch` (BIL-1, ADR 0014): form
 * bodies, the secret key as the bearer header only, an `Idempotency-Key` on
 * every create (the `billing_sessions` row id), prices resolved by lookup key
 * and cached for the life of the adapter (one per worker process). Every
 * failure is a `BillingProviderError` with Stripe's `error.code`; no
 * response body reaches a log. Nothing here moves an entitlement: that is the
 * signed webhook's job.
 */
export class StripeBilling implements BillingProvider {
  private prices: ReadonlyMap<string, string> = new Map();

  constructor(
    private readonly config: StripeBillingConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async call<S extends z.ZodTypeAny>(request: StripeRequest, schema: S): Promise<z.output<S>> {
    const operation = `${request.method} /v1${request.path}`;
    const response = await stripeCall(this.fetchImpl, this.config.secretKey, request);
    if (!response.ok) throw new BillingProviderError(response.code, response.status, operation);
    const parsed = schema.safeParse(response.json);
    if (!parsed.success) throw new BillingProviderError("invalid_response", response.status, operation);
    return parsed.data as z.output<S>;
  }

  /** Search by `metadata['north_user_id']` first (the user id is a validated uuid), then create with a per-user idempotency key. */
  async ensureCustomer(raw: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    const input = EnsureCustomerInputSchema.parse(raw);
    const found = await this.call({ method: "GET", path: "/customers/search", query: [["query", `metadata['north_user_id']:'${input.userId}'`], ["limit", "1"]] }, CustomerList);
    const hit = found.data[0];
    if (hit) return Object.freeze({ customerId: hit.id, sandbox: false });
    const created = await this.call({ method: "POST", path: "/customers", form: { email: input.email, metadata: { north_user_id: input.userId } }, idempotencyKey: `north-customer-${input.userId}` }, Customer);
    return Object.freeze({ customerId: created.id, sandbox: false });
  }

  /** The active price behind a lookup key; cached once found, never cached when missing. */
  private async priceId(lookupKey: string): Promise<string> {
    const cached = this.prices.get(lookupKey);
    if (cached) return cached;
    const prices = await this.call({ method: "GET", path: "/prices", query: [["lookup_keys[]", lookupKey], ["active", "true"], ["limit", "1"]] }, PriceList);
    const id = prices.data[0]?.id;
    if (!id) throw new BillingProviderError("lookup_key_not_found", 404, "GET /v1/prices");
    this.prices = new Map([...this.prices, [lookupKey, id]]);
    return id;
  }

  /**
   * Both are card only (founder default): a pack must not complete unpaid (H1)
   * and a subscription's payments settle at once, so `entitlements-tick`'s
   * heal may take "active 24 h after the period start" as a paid period
   * (offering a delayed method later needs the heal to confirm that the
   * period's invoice is paid). A subscription checkout allows the founder's
   * promotion codes; a pack none, at its exact price (no code changes the
   * amount the grant checks). Both expire after `CHECKOUT_OPEN_MINUTES`, the
   * window in which a second checkout is refused (L10).
   */
  private async checkout(input: ParsedCheckoutSessionInput): Promise<BillingSessionResult> {
    const price = await this.priceId(input.lookupKey);
    const pack = input.mode === "payment" ? packForLookupKey(input.lookupKey) : null;
    const metadata = { north_user_id: input.clientReferenceId, ...(pack ? { north_pack_id: pack.id } : {}) };
    const subscription = input.mode === "subscription";
    const form = {
      mode: input.mode,
      customer: input.customerId,
      line_items: [{ price, quantity: 1 }],
      payment_method_types: ["card"],
      ...(subscription ? { allow_promotion_codes: true } : {}),
      client_reference_id: input.clientReferenceId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: Math.floor(this.clock().getTime() / 1000) + CHECKOUT_OPEN_MINUTES * 60,
      metadata,
      ...(subscription ? { subscription_data: { metadata: { north_user_id: input.clientReferenceId } } } : {}),
    };
    const session = await this.call({ method: "POST", path: "/checkout/sessions", form, idempotencyKey: input.idempotencyKey }, HostedSession);
    return Object.freeze({ url: session.url, providerRef: session.id, sandbox: false });
  }

  async createCheckoutSession(raw: CheckoutSessionInput): Promise<BillingSessionResult> {
    return this.checkout(CheckoutSessionInputSchema.parse(raw));
  }

  async createCreditPackSession(raw: CreditPackSessionInput): Promise<BillingSessionResult> {
    const { packId, ...input } = CreditPackSessionInputSchema.parse(raw);
    return this.checkout(CheckoutSessionInputSchema.parse({ ...input, mode: "payment", lookupKey: packById(packId)?.lookupKey ?? "" }));
  }

  async createPortalSession(raw: PortalSessionInput): Promise<BillingSessionResult> {
    const input = PortalSessionInputSchema.parse(raw);
    const session = await this.call({ method: "POST", path: "/billing_portal/sessions", form: { customer: input.customerId, return_url: input.returnUrl }, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }, HostedSession);
    return Object.freeze({ url: session.url, providerRef: session.id, sandbox: false });
  }

  /** The customer's newest subscription in any status, or the named one of this customer (404 or another customer's: null). */
  async subscription(customerId: string, subscriptionId?: string): Promise<BillingSubscription | null> {
    if (!CustomerIdSchema.safeParse(customerId).success) return null;
    if (subscriptionId !== undefined) return this.namedSubscription(customerId, subscriptionId);
    const list = await this.call({ method: "GET", path: "/subscriptions", query: [["customer", customerId], ["status", "all"], ["limit", "1"]] }, SubscriptionList);
    const latest = list.data[0];
    return latest ? toSubscription(latest) : null;
  }

  private async namedSubscription(customerId: string, subscriptionId: string): Promise<BillingSubscription | null> {
    if (!SubscriptionIdSchema.safeParse(subscriptionId).success) return null;
    try {
      const found = await this.call({ method: "GET", path: `/subscriptions/${subscriptionId}` }, SubscriptionObject);
      return found.customer === customerId ? toSubscription(found) : null;
    } catch (cause) {
      if (cause instanceof BillingProviderError && cause.code === "resource_missing") return null;
      throw cause;
    }
  }
}
