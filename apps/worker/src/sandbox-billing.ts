import { Hono, type Context } from "hono";
import { CREDIT_PACKS, planByLookupKey } from "@north/core";
import { BillingProviderError, CustomerIdSchema, SANDBOX_STRIPE_WEBHOOK_SECRET, signedSandboxEvent, type BillingSubscription, type SandboxBilling, type SandboxCheckoutSession, type SandboxStripeEvent, type SignedSandboxEvent } from "@north/integrations";
import { z } from "zod";

/**
 * BIL-1 (ADR 0014): the sandbox Stripe's hosted pages, served by the worker
 * in sandbox mode on a loopback host only (mounted by `sandboxRoutes`). Each
 * button asks `SandboxBilling` for the Stripe-shaped events a real account
 * would send, signs them with the sandbox secret and POSTs them, one by one,
 * to the worker's own `/webhooks/stripe`: the only path that changes an
 * entitlement. Pages are text-only HTML (every value escaped, no script);
 * the only redirects are the session's stored success URL and the worker's
 * own portal path, never a URL from the request.
 */

export const SANDBOX_PORTAL_ACTIONS = ["cancel", "end", "advance", "fail"] as const;
export type SandboxPortalAction = (typeof SANDBOX_PORTAL_ACTIONS)[number];

/** What one signed POST to the webhook returned; `applied` is whether `apply-billing-event` finished within the wait (null when nothing was stored). */
export interface Delivery {
  readonly eventId: string;
  readonly type: string;
  readonly status: number;
  readonly response: unknown;
  readonly applied: boolean | null;
  /** The exact bytes and header that were posted (a harness replays them to prove idempotency). */
  readonly request: { readonly body: string; readonly signature: string };
}

export type Deliver = (signed: SignedSandboxEvent, type: string) => Promise<Delivery>;

export interface SandboxBillingRoutesOptions {
  readonly billing: SandboxBilling;
  /** The worker's clock: the webhook verifies the signature's timestamp against the same clock. */
  readonly clock: () => Date;
  readonly deliver: Deliver;
  /** `NEXT_PUBLIC_APP_URL`, for the portal's way back to North. */
  readonly appUrl: string;
}

const SessionIdSchema = z.string().regex(/^cs_[A-Za-z0-9_]{1,120}$/);
const ActionSchema = z.enum(SANDBOX_PORTAL_ACTIONS);
const CHECKOUT = "/sandbox/billing/checkout";
const PORTAL = "/sandbox/billing/portal";

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

function page(title: string, lines: readonly string[]): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${lines.join("")}<p><small>Sandbox: no card is charged and nothing leaves this machine.</small></p></main></body></html>`;
}

const para = (text: string, testId?: string): string => `<p${testId ? ` data-testid="${testId}"` : ""}>${escapeHtml(text)}</p>`;
const form = (action: string, label: string): string => `<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(label)}</button></form>`;
const link = (href: string, label: string): string => `<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;

/** No script, style or frame may load; `form-action` stays open because the checkout's 303 goes to the app's own origin. */
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" } as const;

/** What the session sells, in words. */
function offer(lookupKey: string, packId: string | null): string {
  const plan = planByLookupKey(lookupKey);
  if (plan) return `North ${plan.name}: $${plan.priceUsd} a month, ${plan.companyLimit} ${plan.companyLimit === 1 ? "company" : "companies"}, ${plan.monthlyCredits} credits a month.`;
  const pack = CREDIT_PACKS.find((p) => p.id === packId || p.lookupKey === lookupKey);
  return pack ? `Credit pack: ${pack.credits} credits for $${pack.priceUsd}.` : "Unknown item.";
}

const providerStatus = (cause: unknown): 404 | 400 | null => (cause instanceof BillingProviderError ? (cause.code === "resource_missing" ? 404 : cause.code === "subscription_canceled" ? 400 : null) : null);

const wantsJson = (c: Context): boolean => (c.req.header("accept") ?? "").includes("application/json");

/** Signs and posts each event in order, waiting for one before the next (Stripe's order for one customer). */
async function deliverAll(options: SandboxBillingRoutesOptions, events: readonly SandboxStripeEvent[]): Promise<readonly Delivery[]> {
  const out: Delivery[] = [];
  for (const event of events) out.push(await options.deliver(signedSandboxEvent(event, SANDBOX_STRIPE_WEBHOOK_SECRET, options.clock()), event.type));
  return out;
}

const accepted = (deliveries: readonly Delivery[]): boolean => deliveries.every((d) => d.status === 200 || d.status === 202);

/** The answer to a simulated click: JSON for a harness, else a redirect (303) for the browser; a refused delivery is 502 either way. */
function answer(c: Context, deliveries: readonly Delivery[], redirect: string) {
  const ok = accepted(deliveries);
  if (wantsJson(c)) return c.json({ ok, deliveries }, ok ? 200 : 502);
  if (!ok) return c.html(page("Webhook refused", deliveries.map((d) => para(`${d.type} ${d.eventId}: ${d.status}`))), 502, HTML_HEADERS);
  return c.redirect(redirect, 303);
}

async function simulate(c: Context, run: () => Promise<readonly SandboxStripeEvent[]>, options: SandboxBillingRoutesOptions, redirect: string) {
  let events: readonly SandboxStripeEvent[];
  try {
    events = await run();
  } catch (cause) {
    const status = providerStatus(cause);
    if (status === null) throw cause;
    return c.json({ error: cause instanceof Error ? cause.message : "refused" }, status);
  }
  return answer(c, await deliverAll(options, events), redirect);
}

/** The checkout page: what is bought, one form that completes it, and the stored way back. */
function checkoutPage(session: SandboxCheckoutSession): string {
  return page("North sandbox checkout", [
    para(offer(session.lookupKey, session.packId), "sandbox-checkout-offer"),
    para(`Session ${session.id} for customer ${session.customerId}: ${session.status}.`, "sandbox-checkout-status"),
    form(`${CHECKOUT}/${session.id}/complete`, session.mode === "subscription" ? "Subscribe (sandbox)" : "Pay (sandbox)"),
    link(session.cancelUrl, "Cancel and return to North"),
  ]);
}

const PORTAL_LABELS: Readonly<Record<SandboxPortalAction, string>> = Object.freeze({ cancel: "Cancel at the period end", end: "End the subscription now", advance: "Advance to the next period (renewal paid)", fail: "Fail the next payment" });

/** The portal page: the subscription's state, one form per simulated action, and the way back to the app. */
function portalPage(customerId: string, subscription: BillingSubscription | null, done: SandboxPortalAction | null, appUrl: string): string {
  const state = subscription ? `Subscription ${subscription.id}: ${subscription.status}${subscription.cancelAtPeriodEnd ? ", cancels at the period end" : ""}; period ends ${subscription.periodEnd ?? "unknown"}.` : "No subscription.";
  return page("North sandbox billing portal", [
    para(`Customer ${customerId}.`),
    para(state, "sandbox-portal-subscription"),
    ...(done ? [para(`Done: ${done}.`, "sandbox-portal-done")] : []),
    ...SANDBOX_PORTAL_ACTIONS.map((action) => form(`${PORTAL}/${customerId}/${action}`, PORTAL_LABELS[action])),
    link(`${appUrl.replace(/\/$/, "")}/settings/billing`, "Return to North"),
  ]);
}

export function sandboxBillingRoutes(options: SandboxBillingRoutesOptions): Hono {
  const app = new Hono();
  const { billing } = options;

  app.get(`${CHECKOUT}/:id`, async (c) => {
    const id = SessionIdSchema.safeParse(c.req.param("id"));
    const session = id.success ? await billing.checkoutSession(id.data) : null;
    if (!id.success || !session) return c.html(page("Checkout not found", [para("No sandbox checkout session has this id.")]), 404, HTML_HEADERS);
    return c.html(checkoutPage(session), 200, HTML_HEADERS);
  });

  app.post(`${CHECKOUT}/:id/complete`, async (c) => {
    const id = SessionIdSchema.safeParse(c.req.param("id"));
    const session = id.success ? await billing.checkoutSession(id.data) : null;
    if (!id.success || !session) return c.json({ error: "no sandbox checkout session has this id" }, 404);
    return simulate(c, () => billing.completeCheckout(session.id), options, session.successUrl);
  });

  app.get(`${PORTAL}/:customer`, async (c) => {
    const customer = CustomerIdSchema.safeParse(c.req.param("customer"));
    if (!customer.success) return c.html(page("Customer not found", [para("Not a sandbox customer id.")]), 404, HTML_HEADERS);
    const done = ActionSchema.safeParse(c.req.query("done"));
    return c.html(portalPage(customer.data, await billing.subscription(customer.data), done.success ? done.data : null, options.appUrl), 200, HTML_HEADERS);
  });

  app.post(`${PORTAL}/:customer/:action`, async (c) => {
    const customer = CustomerIdSchema.safeParse(c.req.param("customer"));
    const action = ActionSchema.safeParse(c.req.param("action"));
    if (!customer.success || !action.success) return c.json({ error: `expected ${PORTAL}/<cus_…>/<${SANDBOX_PORTAL_ACTIONS.join("|")}>` }, 404);
    const runs: Readonly<Record<SandboxPortalAction, () => Promise<readonly SandboxStripeEvent[]>>> = {
      cancel: () => billing.cancelAtPeriodEnd(customer.data),
      end: () => billing.endNow(customer.data),
      advance: () => billing.advancePeriod(customer.data),
      fail: () => billing.failPayment(customer.data),
    };
    return simulate(c, runs[action.data], options, `${PORTAL}/${customer.data}?done=${action.data}`);
  });
  return app;
}

export interface WebhookDeliveryOptions {
  /** The worker's own webhook, e.g. `http://127.0.0.1:3101/webhooks/stripe`. */
  readonly url: string;
  /** Resolves true once the stored event is applied (polls `billing_events.applied_at`). */
  readonly waitApplied: (billingEventId: string) => Promise<boolean>;
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

const DELIVERY_TIMEOUT_MS = 10_000;

/** The server's `deliver`: a real HTTP POST to its own webhook, then a wait for the apply so the next event lands on the projected state. */
export function webhookDelivery(options: WebhookDeliveryOptions): Deliver {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return async (signed, type) => {
    const response = await fetchImpl(options.url, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signed.signature }, body: signed.body, redirect: "manual", signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) });
    const body: unknown = await response.json().catch(() => null);
    const billingEventId = (body as { billingEventId?: unknown } | null)?.billingEventId;
    const applied = response.status === 200 && typeof billingEventId === "string" ? await options.waitApplied(billingEventId) : null;
    return Object.freeze({ eventId: signed.eventId, type, status: response.status, response: body, applied, request: Object.freeze({ body: signed.body, signature: signed.signature }) });
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `waitApplied` over a reader of `billing_events` (the server passes `getBillingEvent`): true once `applied_at` is set, false after the timeout. */
export function appliedPoller(read: (billingEventId: string) => Promise<{ readonly appliedAt: string | null } | null>, timeoutMs = 8_000, intervalMs = 100): (billingEventId: string) => Promise<boolean> {
  return async (billingEventId) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      if ((await read(billingEventId))?.appliedAt) return true;
      if (Date.now() >= until) return false;
      await sleep(intervalMs);
    }
  };
}
