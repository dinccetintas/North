import { SUBSCRIPTION_PLANS, type Entitlement } from "@north/core";
import { getBillingSession, getEntitlement, getProfile, setBillingSessionFailed, setBillingSessionReady, setStripeCustomer, type BillingSessionRecord } from "@north/db";
import { BillingProviderError } from "@north/integrations";
import type { WorkerDeps } from "../deps";
import type { StepRunner } from "./steps";

export { applyBillingEvent, type AppliedBillingEvent } from "./billing-apply";

/**
 * BIL-1 (ADR 0014): the web inserts a `requested` billing session; the
 * worker, which alone holds the Stripe key, creates the provider session and
 * writes its URL (`ready`) or a fixed message (`failed`). Steps `load`,
 * `customer`, `session`; nothing here changes an entitlement (only the
 * signed webhook does).
 */

export type BillingSessionOutcome =
  | { readonly sessionId: string; readonly status: "ready"; readonly url: string }
  | { readonly sessionId: string; readonly status: "failed"; readonly error: string }
  | { readonly sessionId: string; readonly status: "skipped"; readonly reason: string };

export interface BillingSessionOptions {
  /** `NEXT_PUBLIC_APP_URL`: the success, cancel and return URLs point back at the app's billing page. */
  readonly appUrl: string;
  /** The function's last attempt: an unexpected error fails the session instead of retrying. */
  readonly finalAttempt: boolean;
  /** The event's user: a row of another user is left alone (`skipped: user mismatch`). */
  readonly expectedUserId?: string;
}

/** Fixed, user-readable messages; the provider's body never reaches the page. */
export const BILLING_SESSION_MESSAGES = Object.freeze({
  subscribed: "You already have a subscription. Change plans in Manage billing.",
  noAccount: "Your account has no billing record yet. Try again in a minute.",
  noEmail: "Your account has no email address for billing. Add one and try again.",
  resource_missing: "Billing could not find your customer record. Try again; if it persists, contact support.",
  subscription_canceled: "That subscription has already ended. Choose a plan to subscribe again.",
  refused: "The payment provider refused the request. Try again in a few minutes.",
  unavailable: "Billing is unavailable right now. Try again in a few minutes.",
});

/** A subscription that has not ended: plan changes go through the portal, never a second checkout. */
const hasSubscription = (entitlement: Entitlement): boolean => entitlement.stripeSubscriptionId !== null && entitlement.status !== "ended";

type Loaded = { readonly kind: "skip"; readonly reason: string } | { readonly kind: "refuse"; readonly message: string } | { readonly kind: "open"; readonly session: BillingSessionRecord; readonly customerId: string | null; readonly email: string };

async function loadSession(deps: WorkerDeps, sessionId: string, expectedUserId: string | undefined): Promise<Loaded> {
  const session = await getBillingSession(deps.db, sessionId);
  if (!session) return { kind: "skip", reason: "missing" };
  if (expectedUserId !== undefined && session.userId !== expectedUserId) return { kind: "skip", reason: "user mismatch" };
  if (session.status !== "requested") return { kind: "skip", reason: session.status };
  const entitlement = await getEntitlement(deps.db, session.userId);
  if (!entitlement) return { kind: "refuse", message: BILLING_SESSION_MESSAGES.noAccount };
  if (session.kind === "checkout" && hasSubscription(entitlement)) return { kind: "refuse", message: BILLING_SESSION_MESSAGES.subscribed };
  const email = (await getProfile(deps.db, session.userId))?.email ?? "";
  if (!entitlement.stripeCustomerId && !email) return { kind: "refuse", message: BILLING_SESSION_MESSAGES.noEmail };
  return { kind: "open", session, customerId: entitlement.stripeCustomerId, email };
}

/** The customer the session is opened for: the stored one, else `ensureCustomer` (idempotent per user at the provider) stored on the entitlement. */
async function ensureCustomer(deps: WorkerDeps, userId: string, known: string | null, email: string): Promise<string> {
  if (known) return known;
  const { customerId } = await deps.integrations.billing.ensureCustomer({ userId, email });
  await setStripeCustomer(deps.db, userId, customerId);
  return customerId;
}

/** Opens the provider session for the row's kind and stores its URL. The row id is the idempotency key. */
async function openSession(deps: WorkerDeps, session: BillingSessionRecord, customerId: string, appUrl: string): Promise<BillingSessionOutcome> {
  const billingUrl = `${appUrl.replace(/\/$/, "")}/settings/billing`;
  const back = { successUrl: `${billingUrl}?checkout=${session.id}`, cancelUrl: `${billingUrl}?canceled=1`, clientReferenceId: session.userId, idempotencyKey: session.id };
  const provider = deps.integrations.billing;
  let opened: { readonly url: string; readonly providerRef: string };
  if (session.kind === "portal") opened = await provider.createPortalSession({ customerId, returnUrl: billingUrl, idempotencyKey: session.id });
  else if (session.kind === "credit_pack") opened = await provider.createCreditPackSession({ customerId, packId: session.packId ?? "", ...back });
  else opened = await provider.createCheckoutSession({ customerId, lookupKey: SUBSCRIPTION_PLANS[session.planId ?? "solo"].lookupKey, mode: "subscription", ...back });
  const ready = await setBillingSessionReady(deps.db, session.id, { url: opened.url, providerRef: opened.providerRef });
  return { sessionId: session.id, status: "ready", url: ready.url ?? opened.url };
}

async function fail(deps: WorkerDeps, sessionId: string, message: string): Promise<BillingSessionOutcome> {
  await setBillingSessionFailed(deps.db, sessionId, message);
  return { sessionId, status: "failed", error: message };
}

/** A provider refusal fails the session with its fixed message; anything else retries, and fails the session on the last attempt. */
async function guarded<T>(deps: WorkerDeps, sessionId: string, finalAttempt: boolean, fn: () => Promise<T>): Promise<T | BillingSessionOutcome> {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof BillingProviderError) {
      const message = cause.code === "resource_missing" || cause.code === "subscription_canceled" ? BILLING_SESSION_MESSAGES[cause.code] : BILLING_SESSION_MESSAGES.refused;
      console.warn(`[billing] session ${sessionId}: provider refused (${cause.code})`);
      return fail(deps, sessionId, message);
    }
    if (!finalAttempt) throw cause;
    console.error(`[billing] session ${sessionId} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return fail(deps, sessionId, BILLING_SESSION_MESSAGES.unavailable);
  }
}

const isOutcome = (value: unknown): value is BillingSessionOutcome => typeof value === "object" && value !== null && "status" in value && "sessionId" in value;

/** `create-billing-session` (on `billing/session_requested`): load → customer → session, each a durable step. */
export async function createBillingSession(deps: WorkerDeps, step: StepRunner, sessionId: string, options: BillingSessionOptions): Promise<BillingSessionOutcome> {
  const loaded = await step.run("load", () => loadSession(deps, sessionId, options.expectedUserId));
  if (loaded.kind === "skip") return { sessionId, status: "skipped", reason: loaded.reason };
  if (loaded.kind === "refuse") return step.run("refuse", () => fail(deps, sessionId, loaded.message));
  const customer = await step.run("customer", () => guarded(deps, sessionId, options.finalAttempt, () => ensureCustomer(deps, loaded.session.userId, loaded.customerId, loaded.email)));
  if (isOutcome(customer)) return customer;
  return step.run("session", async () => {
    const outcome = await guarded(deps, sessionId, options.finalAttempt, () => openSession(deps, loaded.session, customer, options.appUrl));
    return outcome;
  });
}
