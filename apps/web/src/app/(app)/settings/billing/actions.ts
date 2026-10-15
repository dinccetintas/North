"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createBillingSession, getBillingSession } from "@north/db";
import { EVENT } from "@north/core/events";
import { CREDIT_PACKS, SUBSCRIPTION_PLAN_IDS, type SubscriptionPlanId } from "@north/core/billing/plans";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { loadCheckoutState } from "@/lib/billing-data";
import { safeRedirectUrl } from "@/lib/billing-view";

/**
 * BIL-1 (ADR 0014): the web never holds a Stripe key and never creates a
 * provider session. Each action inserts a `requested` `billing_sessions` row
 * under RLS (the policy admits nothing else), tells the worker, and sends
 * the browser to the page that waits for the worker's URL.
 */

const PlanIdSchema = z.enum(SUBSCRIPTION_PLAN_IDS);
const PackIdSchema = z.enum(CREDIT_PACKS.map((p) => p.id) as [string, ...string[]]);
const SessionIdSchema = z.uuid();

type SessionRequest = { readonly kind: "checkout"; readonly planId: SubscriptionPlanId } | { readonly kind: "portal" } | { readonly kind: "credit_pack"; readonly packId: string };

const billingError = (message: string): never => redirect(`/settings/billing?error=${encodeURIComponent(message)}`);

/** Fixed message for the browser; the cause goes to the server log only. */
const START_FAILED = "Billing could not start. Try again in a minute.";

async function requestSession(request: SessionRequest): Promise<never> {
  const user = await currentUser();
  if (!user) redirect("/login");
  let sessionId: string | null = null;
  try {
    const session = await createBillingSession(await createClient(), { userId: user.id, ...request });
    await inngest.send({ name: EVENT.billingSessionRequested, data: { sessionId: session.id, userId: user.id } });
    sessionId = session.id;
  } catch (cause) {
    console.error("[billing] could not request a session", request.kind, cause);
  }
  if (!sessionId) return billingError(START_FAILED);
  redirect(`/settings/billing/go/${sessionId}`);
}

/** A new subscription to `planId` through Stripe Checkout. */
export async function startCheckoutAction(planId: string): Promise<void> {
  const parsed = PlanIdSchema.safeParse(planId);
  if (!parsed.success) return billingError("Unknown plan.");
  await requestSession({ kind: "checkout", planId: parsed.data });
}

/** The Stripe billing portal: card, invoices, plan switch, cancel. */
export async function startPortalAction(): Promise<void> {
  await requestSession({ kind: "portal" });
}

/** A one-off credit pack through Stripe Checkout (`payment` mode); the webhook grants it. */
export async function buyCreditsAction(packId: string): Promise<void> {
  const parsed = PackIdSchema.safeParse(packId);
  if (!parsed.success) return billingError("Unknown credit pack.");
  await requestSession({ kind: "credit_pack", packId: parsed.data });
}

export type SessionState = { readonly status: "requested" | "ready" | "failed" | "missing"; readonly url: string | null };

/** Polled by the redirect page: the session row as the owner may read it; the URL only when it is safe to follow. */
export async function billingSessionStateAction(sessionId: string): Promise<SessionState> {
  const user = await currentUser();
  const id = SessionIdSchema.safeParse(sessionId);
  if (!user || !id.success) return { status: "missing", url: null };
  const session = await getBillingSession(await createClient(), id.data);
  if (!session) return { status: "missing", url: null };
  const url = session.status === "ready" ? safeRedirectUrl(session.url) : null;
  if (session.status === "ready" && url === null) return { status: "failed", url: null };
  return { status: session.status, url };
}

/** Polled after the Stripe redirect: confirmed only once the webhook changed the entitlement (or granted the pack). */
export async function checkoutStateAction(sessionId: string | null): Promise<{ readonly confirmed: boolean }> {
  const user = await currentUser();
  if (!user) return { confirmed: false };
  const id = sessionId === null ? null : SessionIdSchema.safeParse(sessionId);
  return loadCheckoutState(await createClient(), user.id, id?.success ? id.data : null);
}
