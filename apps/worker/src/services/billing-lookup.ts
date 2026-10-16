import { billingCustomerId, billingUserHint, type BillingEvent } from "@north/core";
import { getEntitlement, type DbClient } from "@north/db";
import { z } from "zod";
import type { WorkerDeps } from "../deps";

/**
 * BIL-1 (ADR 0014): whose event is this? The Stripe customer the worker
 * stored on the user's entitlement first; on `checkout.session.completed`
 * only, the `client_reference_id` the worker set at checkout (a uuid that
 * must be an existing user whose entitlement does not already name another
 * customer). Anything else is unknown: stored, not applied.
 */

const CustomerSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const RowSchema = z.object({ user_id: z.uuid() }).nullable();

/**
 * The user whose entitlement carries this Stripe customer, or null. A direct
 * service-role select (`entitlements.stripe_customer_id` is unique): the db
 * package has no repository function for it yet.
 */
export async function userIdForCustomer(db: DbClient, customerId: string): Promise<string | null> {
  const customer = CustomerSchema.safeParse(customerId);
  if (!customer.success) return null;
  const { data, error } = await db.from("entitlements").select("user_id").eq("stripe_customer_id", customer.data).maybeSingle();
  if (error) throw new Error(`Could not resolve Stripe customer: ${error.message}`);
  const row = RowSchema.safeParse(data);
  return row.success && row.data ? row.data.user_id : null;
}

/** The user the event belongs to, or null (the route answers 202 and stores the event unapplied). */
export async function resolveBillingUser(deps: WorkerDeps, event: BillingEvent): Promise<string | null> {
  const customer = billingCustomerId(event);
  if (customer) {
    const byCustomer = await userIdForCustomer(deps.db, customer);
    if (byCustomer) return byCustomer;
  }
  if (event.type !== "checkout.session.completed") return null;
  const hint = billingUserHint(event);
  if (!hint) return null;
  const entitlement = await getEntitlement(deps.db, hint);
  if (!entitlement) return null;
  if (customer && entitlement.stripeCustomerId !== null && entitlement.stripeCustomerId !== customer) return null;
  return hint;
}
