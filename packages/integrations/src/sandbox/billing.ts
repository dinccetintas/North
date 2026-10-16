import { packById } from "@north/core";
import {
  CheckoutSessionInputSchema,
  CreditPackSessionInputSchema,
  CustomerIdSchema,
  EnsureCustomerInputSchema,
  PortalSessionInputSchema,
  type BillingProvider,
  type BillingSessionResult,
  type BillingSubscription,
  type CheckoutSessionInput,
  type CreditPackSessionInput,
  type EnsureCustomerInput,
  type EnsureCustomerResult,
  type ParsedCheckoutSessionInput,
  type PortalSessionInput,
  packForLookupKey,
} from "../billing-types";
import { BillingProviderError } from "../errors";
import type { SandboxSink } from "../types";
import { checkoutSessionObject, invoiceObject, periodOf, stripeEvent, subscriptionObject } from "./billing-events";
import { BillingStore, type SandboxCheckoutSession, type SandboxStripeEvent, type SandboxSubscription } from "./billing-store";
import { defaultSiteBaseUrl } from "./deploy";
import { defaultSandboxRoot } from "./files";
import { recordSandboxEvent } from "./record";

export { SANDBOX_STRIPE_API_VERSION, SANDBOX_STRIPE_WEBHOOK_SECRET, addMonths, signSandboxWebhook, signedSandboxEvent, type SignedSandboxEvent } from "./billing-events";
export { BillingStore, SandboxCheckoutSessionSchema, SandboxStripeEventSchema, SandboxSubscriptionSchema, type SandboxCheckoutSession, type SandboxStripeEvent, type SandboxSubscription } from "./billing-store";

/** Where the worker serves the sandbox checkout and portal pages (loopback, sandbox mode only). */
export const SANDBOX_BILLING_CHECKOUT_PATH = "/sandbox/billing/checkout";
export const SANDBOX_BILLING_PORTAL_PATH = "/sandbox/billing/portal";

export interface SandboxBillingOptions {
  /** Public base URL of the worker (`SANDBOX_SITE_BASE_URL`, default `http://127.0.0.1:<WORKER_PORT>`). */
  readonly siteBaseUrl?: string;
}

const missing = (what: string): BillingProviderError => new BillingProviderError("resource_missing", 404, `sandbox ${what}`);
const ended = (): BillingProviderError => new BillingProviderError("subscription_canceled", 400, "sandbox subscription");
type Events = readonly SandboxStripeEvent[];

/**
 * The platform's Stripe account in sandbox (BIL-1, ADR 0014): customers,
 * checkout sessions and subscriptions are files under `<root>/billing`, the
 * checkout and portal URLs are pages on the worker, and the simulation
 * methods return the Stripe-shaped events a real account would send. They
 * change nothing an entitlement reads: the worker signs what they return and
 * posts it to its own `/webhooks/stripe`, the one path that moves an
 * entitlement. Each simulated click is idempotent on the state it changes
 * (a second "complete" returns the same events, so the webhook sees a
 * replay), and ids come from per-root counters that survive a restart.
 */
export class SandboxBilling implements BillingProvider {
  private readonly store: BillingStore;
  private readonly baseUrl: string;

  constructor(
    private readonly sink?: SandboxSink,
    root: string = defaultSandboxRoot(),
    private readonly clock: () => Date = () => new Date(),
    options: SandboxBillingOptions = {},
  ) {
    this.store = new BillingStore(root);
    this.baseUrl = (options.siteBaseUrl ?? defaultSiteBaseUrl()).replace(/\/+$/, "");
  }

  private record(op: string, ref: string, payload: Record<string, unknown>): Promise<unknown> {
    return recordSandboxEvent(this.sink, { provider: "billing", op, companyId: null, ref, payload });
  }

  async ensureCustomer(raw: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    const input = EnsureCustomerInputSchema.parse(raw);
    const result = await this.store.exclusive(async () => {
      const known = await this.store.lookup("user", input.userId);
      if (known && (await this.store.readCustomer(known))) return { customerId: known, created: false };
      const [customerId = ""] = await this.store.nextIds("cus");
      await this.store.writeCustomer({ id: customerId, userId: input.userId, email: input.email, createdAt: this.clock().toISOString() });
      await this.store.remember("user", input.userId, customerId);
      return { customerId, created: true };
    });
    await this.record("ensureCustomer", result.customerId, { created: result.created });
    return Object.freeze({ customerId: result.customerId, sandbox: true });
  }

  private async requireCustomer(customerId: string): Promise<void> {
    if (!(await this.store.readCustomer(customerId))) throw missing(`customer ${customerId}`);
  }

  private async openSession(input: ParsedCheckoutSessionInput, packId: string | null): Promise<BillingSessionResult> {
    const session = await this.store.exclusive(async () => {
      await this.requireCustomer(input.customerId);
      const known = await this.store.lookup("checkout", input.idempotencyKey);
      const existing = known ? await this.store.readSession(known) : null;
      if (existing) return existing;
      const [id = ""] = await this.store.nextIds("cs");
      const created: SandboxCheckoutSession = {
        id,
        customerId: input.customerId,
        mode: input.mode,
        lookupKey: input.lookupKey,
        packId,
        clientReferenceId: input.clientReferenceId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        url: `${this.baseUrl}${SANDBOX_BILLING_CHECKOUT_PATH}/${id}`,
        status: "open",
        created: Math.floor(this.clock().getTime() / 1000),
        completedAt: null,
        subscriptionId: null,
        events: [],
      };
      await this.store.writeSession(created);
      await this.store.remember("checkout", input.idempotencyKey, id);
      return created;
    });
    await this.record("createCheckoutSession", session.id, { mode: session.mode, lookupKey: session.lookupKey, packId: session.packId });
    return Object.freeze({ url: session.url, providerRef: session.id, sandbox: true });
  }

  async createCheckoutSession(raw: CheckoutSessionInput): Promise<BillingSessionResult> {
    const input = CheckoutSessionInputSchema.parse(raw);
    return this.openSession(input, input.mode === "payment" ? (packForLookupKey(input.lookupKey)?.id ?? null) : null);
  }

  async createCreditPackSession(raw: CreditPackSessionInput): Promise<BillingSessionResult> {
    const { packId, ...input } = CreditPackSessionInputSchema.parse(raw);
    const lookupKey = packById(packId)?.lookupKey ?? "";
    return this.openSession(CheckoutSessionInputSchema.parse({ ...input, mode: "payment", lookupKey }), packId);
  }

  async createPortalSession(raw: PortalSessionInput): Promise<BillingSessionResult> {
    const input = PortalSessionInputSchema.parse(raw);
    const providerRef = await this.store.exclusive(async () => {
      await this.requireCustomer(input.customerId);
      const known = input.idempotencyKey ? await this.store.lookup("portal", input.idempotencyKey) : null;
      if (known) return known;
      const [id = ""] = await this.store.nextIds("bps");
      if (input.idempotencyKey) await this.store.remember("portal", input.idempotencyKey, id);
      return id;
    });
    await this.record("createPortalSession", providerRef, { customerId: input.customerId });
    return Object.freeze({ url: `${this.baseUrl}${SANDBOX_BILLING_PORTAL_PATH}/${input.customerId}`, providerRef, sandbox: true });
  }

  /** The current subscription; with `subscriptionId`, that one: the current one, or one it superseded (ended, so reported `canceled`, with the lookup key it was sold at). */
  async subscription(customerId: string, subscriptionId?: string): Promise<BillingSubscription | null> {
    if (!CustomerIdSchema.safeParse(customerId).success) return null;
    const current = await this.store.readSubscription(customerId);
    if (!current) return null;
    if (subscriptionId !== undefined && subscriptionId !== current.id) {
      if (!current.superseded.includes(subscriptionId)) return null;
      return Object.freeze({ id: subscriptionId, status: "canceled", lookupKey: current.supersededLookupKeys[subscriptionId] ?? null, periodEnd: null, cancelAtPeriodEnd: false, sandbox: true });
    }
    const periodEnd = periodOf(current, current.cycle).end;
    return Object.freeze({ id: current.id, status: current.status, lookupKey: current.lookupKey, periodEnd: new Date(periodEnd * 1000).toISOString(), cancelAtPeriodEnd: current.cancelAtPeriodEnd, sandbox: true });
  }

  /** The session behind a sandbox checkout page, or null; the worker renders what is being bought from it. */
  checkoutSession(sessionId: string): Promise<SandboxCheckoutSession | null> {
    return this.store.readSession(sessionId);
  }

  /** The "Pay" button: a subscription emits checkout + subscription.created + invoice.paid, a pack one payment checkout. */
  async completeCheckout(sessionId: string): Promise<Events> {
    const events = await this.store.exclusive(async () => {
      const session = await this.store.readSession(sessionId);
      if (!session) throw missing(`checkout session ${sessionId}`);
      if (session.status === "complete") return session.events;
      const { events: emitted, subscriptionId } = session.mode === "subscription" ? await this.subscribe(session) : await this.purchase(session);
      await this.store.writeSession({ ...session, status: "complete", completedAt: this.clock().toISOString(), subscriptionId, events: [...emitted] });
      return emitted;
    });
    await this.record("completeCheckout", sessionId, { events: events.map((e) => e.id) });
    return events;
  }

  private async subscribe(session: SandboxCheckoutSession): Promise<{ readonly events: Events; readonly subscriptionId: string }> {
    const created = await this.store.stamp(this.clock());
    const previous = await this.store.readSubscription(session.customerId);
    const [id = ""] = await this.store.nextIds("sub");
    const [itemId = ""] = await this.store.nextIds("si");
    const [invoiceId = ""] = await this.store.nextIds("in");
    const [lineId = ""] = await this.store.nextIds("il");
    const subscription: SandboxSubscription = {
      id,
      customerId: session.customerId,
      userId: session.clientReferenceId,
      lookupKey: session.lookupKey,
      itemId,
      status: "active",
      cancelAtPeriodEnd: false,
      cancelAt: null,
      canceledAt: null,
      endedAt: null,
      anchor: created,
      cycle: 0,
      superseded: previous ? [...previous.superseded, previous.id] : [],
      supersededLookupKeys: previous ? { ...previous.supersededLookupKeys, [previous.id]: previous.lookupKey } : {},
      replay: { cancel: null, end: null, failed: null },
    };
    await this.store.writeSubscription(subscription);
    const [checkoutEvent = "", createdEvent = "", paidEvent = ""] = await this.store.nextIds("evt", 3);
    const invoice = invoiceObject({ id: invoiceId, lineId, subscription, period: periodOf(subscription, 0), paid: true, attempt: 1, billingReason: "subscription_create", created });
    const events = [
      stripeEvent(checkoutEvent, created, "checkout.session.completed", checkoutSessionObject(session, { subscriptionId: id, paymentIntentId: null })),
      stripeEvent(createdEvent, created, "customer.subscription.created", subscriptionObject(subscription)),
      stripeEvent(paidEvent, created, "invoice.paid", invoice),
    ];
    return { events: Object.freeze(events), subscriptionId: id };
  }

  private async purchase(session: SandboxCheckoutSession): Promise<{ readonly events: Events; readonly subscriptionId: null }> {
    const created = await this.store.stamp(this.clock());
    const [paymentIntentId = ""] = await this.store.nextIds("pi");
    const [eventId = ""] = await this.store.nextIds("evt");
    const event = stripeEvent(eventId, created, "checkout.session.completed", checkoutSessionObject(session, { subscriptionId: null, paymentIntentId }));
    return { events: Object.freeze([event]), subscriptionId: null };
  }

  /** The customer's current subscription; refused when there is none or it has ended (unless `allowEnded`). */
  private async current(customerId: string, allowEnded = false): Promise<SandboxSubscription> {
    const subscription = CustomerIdSchema.safeParse(customerId).success ? await this.store.readSubscription(customerId) : null;
    if (!subscription) throw missing(`subscription for ${customerId}`);
    if (!allowEnded && subscription.status === "canceled") throw ended();
    return subscription;
  }

  /** One simulated portal or clock action: serialised, recorded, its events returned. */
  private async simulate(op: string, customerId: string, change: () => Promise<Events>): Promise<Events> {
    const events = await this.store.exclusive(change);
    await this.record(op, customerId, { events: events.map((e) => e.id) });
    return events;
  }

  /** Portal "Cancel plan": `customer.subscription.updated` with `cancel_at_period_end`; agents keep running until the end. */
  cancelAtPeriodEnd(customerId: string): Promise<Events> {
    return this.simulate("cancelAtPeriodEnd", customerId, async () => {
      const subscription = await this.current(customerId);
      if (subscription.cancelAtPeriodEnd && subscription.replay.cancel) return [subscription.replay.cancel];
      const created = await this.store.stamp(this.clock());
      const next: SandboxSubscription = { ...subscription, cancelAtPeriodEnd: true, cancelAt: periodOf(subscription, subscription.cycle).end, canceledAt: created };
      const [eventId = ""] = await this.store.nextIds("evt");
      const event = stripeEvent(eventId, created, "customer.subscription.updated", subscriptionObject(next), { cancel_at_period_end: false, cancel_at: null, canceled_at: null });
      await this.store.writeSubscription({ ...next, replay: { ...next.replay, cancel: event } });
      return [event];
    });
  }

  private async end(subscription: SandboxSubscription, endedAt: number | null): Promise<Events> {
    const created = await this.store.stamp(this.clock());
    const next: SandboxSubscription = { ...subscription, status: "canceled", endedAt: endedAt ?? created, canceledAt: subscription.canceledAt ?? created };
    const [eventId = ""] = await this.store.nextIds("evt");
    const event = stripeEvent(eventId, created, "customer.subscription.deleted", subscriptionObject(next));
    await this.store.writeSubscription({ ...next, replay: { ...next.replay, end: event } });
    return [event];
  }

  /** Portal "End now": `customer.subscription.deleted`, which the worker turns into the kill switch. */
  endNow(customerId: string): Promise<Events> {
    return this.simulate("endNow", customerId, async () => {
      const subscription = await this.current(customerId, true);
      if (subscription.status === "canceled" && subscription.replay.end) return [subscription.replay.end];
      return this.end(subscription, null);
    });
  }

  /** The clock reaches the period end: renewal paid (`invoice.paid` for the next period), or the end of a subscription set to cancel. */
  advancePeriod(customerId: string): Promise<Events> {
    return this.simulate("advancePeriod", customerId, async () => {
      const subscription = await this.current(customerId);
      if (subscription.cancelAtPeriodEnd) return this.end(subscription, periodOf(subscription, subscription.cycle).end);
      const created = await this.store.stamp(this.clock());
      const failed = subscription.replay.failed;
      const invoiceId = failed?.invoiceId ?? (await this.store.nextIds("in"))[0] ?? "";
      const lineId = failed?.lineId ?? (await this.store.nextIds("il"))[0] ?? "";
      const next: SandboxSubscription = { ...subscription, status: "active", cycle: subscription.cycle + 1, replay: { ...subscription.replay, failed: null } };
      const invoice = invoiceObject({ id: invoiceId, lineId, subscription: next, period: periodOf(next, next.cycle), paid: true, attempt: failed ? 2 : 1, billingReason: "subscription_cycle", created });
      const [eventId = ""] = await this.store.nextIds("evt");
      await this.store.writeSubscription(next);
      return [stripeEvent(eventId, created, "invoice.paid", invoice)];
    });
  }

  /** The renewal charge fails: `invoice.payment_failed` for the next period, the subscription goes `past_due`; once per period. */
  failPayment(customerId: string): Promise<Events> {
    return this.simulate("failPayment", customerId, async () => {
      const subscription = await this.current(customerId);
      const failed = subscription.replay.failed;
      if (failed && failed.cycle === subscription.cycle) return [failed.event];
      const created = await this.store.stamp(this.clock());
      const [invoiceId = ""] = await this.store.nextIds("in");
      const [lineId = ""] = await this.store.nextIds("il");
      const invoice = invoiceObject({ id: invoiceId, lineId, subscription, period: periodOf(subscription, subscription.cycle + 1), paid: false, attempt: 1, billingReason: "subscription_cycle", created });
      const [eventId = ""] = await this.store.nextIds("evt");
      const event = stripeEvent(eventId, created, "invoice.payment_failed", invoice);
      await this.store.writeSubscription({ ...subscription, status: "past_due", replay: { ...subscription.replay, failed: { cycle: subscription.cycle, invoiceId, lineId, event } } });
      return [event];
    });
  }
}

export const isSandboxBilling = (provider: BillingProvider): provider is SandboxBilling => provider instanceof SandboxBilling;
