import { ENTITLEMENT_STATUSES, EntitlementSchema, SUBSCRIPTION_PLAN_IDS, type Entitlement } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";

/**
 * BIL-1 (ADR 0014): one `entitlements` row per user, mapped to core's
 * camelCase `Entitlement`. Owners read their own; only the worker (service
 * role) writes, after `applyBillingEvent`. The database enforces it at company
 * creation (`companies_within_entitlement`); `EntitlementError` carries that
 * refusal to the web.
 */
export const ENTITLEMENT_COLUMNS =
  "user_id, plan_id, status, company_limit, monthly_credits, price_usd, period_start, period_end, cancel_at, stripe_customer_id, stripe_subscription_id, ended_at, retention_until, purge_due, last_event_created";

const iso = (value: string): string => new Date(value).toISOString();
const isoOrNull = (value: string | null): string | null => (value === null ? null : iso(value));

const EntitlementRowSchema = z.object({
  user_id: z.string(),
  plan_id: z.enum(SUBSCRIPTION_PLAN_IDS),
  status: z.enum(ENTITLEMENT_STATUSES),
  company_limit: z.number().int(),
  monthly_credits: z.number().int(),
  price_usd: z.coerce.number(),
  period_start: z.string(),
  period_end: z.string(),
  cancel_at: z.string().nullable(),
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  ended_at: z.string().nullable(),
  retention_until: z.string().nullable(),
  purge_due: z.boolean(),
  last_event_created: z.coerce.number().nullable(),
});

/** A row → the frozen core `Entitlement`; timestamps normalised to ISO with milliseconds. */
export function toEntitlement(row: unknown): Entitlement {
  const r = EntitlementRowSchema.parse(row);
  return Object.freeze(
    EntitlementSchema.parse({
      userId: r.user_id,
      planId: r.plan_id,
      status: r.status,
      companyLimit: r.company_limit,
      monthlyCredits: r.monthly_credits,
      priceUsd: r.price_usd,
      periodStart: iso(r.period_start),
      periodEnd: iso(r.period_end),
      cancelAt: isoOrNull(r.cancel_at),
      stripeCustomerId: r.stripe_customer_id,
      stripeSubscriptionId: r.stripe_subscription_id,
      endedAt: isoOrNull(r.ended_at),
      retentionUntil: isoOrNull(r.retention_until),
      purgeDue: r.purge_due,
      lastEventCreated: r.last_event_created,
    }),
  );
}

const toRow = (e: Entitlement) => ({
  user_id: e.userId,
  plan_id: e.planId,
  status: e.status,
  company_limit: e.companyLimit,
  monthly_credits: e.monthlyCredits,
  price_usd: e.priceUsd,
  period_start: e.periodStart,
  period_end: e.periodEnd,
  cancel_at: e.cancelAt,
  stripe_customer_id: e.stripeCustomerId,
  stripe_subscription_id: e.stripeSubscriptionId,
  ended_at: e.endedAt,
  retention_until: e.retentionUntil,
  purge_due: e.purgeDue,
  last_event_created: e.lastEventCreated,
});

/** The user's entitlement, or null when unknown or not visible (owners see their own only). */
export async function getEntitlement(db: DbClient, userId: string): Promise<Entitlement | null> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.from("entitlements").select(ENTITLEMENT_COLUMNS).eq("user_id", id).maybeSingle();
  if (error) throw dbError("Could not load entitlement", error);
  return data ? toEntitlement(data) : null;
}

/** The entitlement of the company's owner (dispatch reads it before every run), or null when the company is unknown or invisible. */
export async function getEntitlementForCompany(db: DbClient, companyId: string): Promise<Entitlement | null> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("companies").select("owner_id").eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load company owner", error);
  return data ? getEntitlement(db, data.owner_id) : null;
}

/** Worker only: stores the projection `applyBillingEvent` returned, validated with core's schema first. */
export async function upsertEntitlement(db: DbClient, entitlement: Entitlement): Promise<Entitlement> {
  const e = EntitlementSchema.parse(entitlement);
  const { data, error } = await db.from("entitlements").upsert(toRow(e), { onConflict: "user_id" }).select(ENTITLEMENT_COLUMNS).single();
  if (error || !data) throw dbError("Could not store entitlement", error);
  return toEntitlement(data);
}

const MAX_LIST = 1000;

/** `entitlements-tick`: trials past their period end with no subscription, oldest first. */
export async function listTrialsToEnd(db: DbClient, now: Date): Promise<readonly Entitlement[]> {
  const { data, error } = await db
    .from("entitlements")
    .select(ENTITLEMENT_COLUMNS)
    .eq("status", "trialing")
    .is("stripe_subscription_id", null)
    .lte("period_end", now.toISOString())
    .order("period_end", { ascending: true })
    .limit(MAX_LIST);
  if (error) throw dbError("Could not list trials to end", error);
  return Object.freeze((data ?? []).map(toEntitlement));
}

/** `retention-sweep`: ended entitlements whose retention has passed, purge-due ones included, oldest first. */
export async function listRetentionDue(db: DbClient, now: Date): Promise<readonly Entitlement[]> {
  const { data, error } = await db
    .from("entitlements")
    .select(ENTITLEMENT_COLUMNS)
    .eq("status", "ended")
    .lte("retention_until", now.toISOString())
    .order("retention_until", { ascending: true })
    .limit(MAX_LIST);
  if (error) throw dbError("Could not list retention due", error);
  return Object.freeze((data ?? []).map(toEntitlement));
}

/** Worker only: marks (or clears) that the user's data may be purged. */
export async function setPurgeDue(db: DbClient, userId: string, due = true): Promise<void> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.from("entitlements").update({ purge_due: z.boolean().parse(due) }).eq("user_id", id).select("user_id").maybeSingle();
  if (error) throw dbError("Could not set purge due", error);
  if (!data) throw new DbError(`Entitlement of ${id} not found`);
}

const StripeIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,200}$/, "a Stripe object id");

/**
 * Worker only: records the Stripe customer the worker created for the user.
 * Idempotent for the same id; a different customer than the one stored is
 * refused, so a user never ends up with two.
 */
export async function setStripeCustomer(db: DbClient, userId: string, customerId: string): Promise<Entitlement> {
  const id = UuidSchema.parse(userId);
  const customer = StripeIdSchema.parse(customerId);
  const current = await getEntitlement(db, id);
  if (!current) throw new DbError(`Entitlement of ${id} not found`);
  if (current.stripeCustomerId === customer) return current;
  if (current.stripeCustomerId !== null) throw new DbError(`User ${id} already has Stripe customer ${current.stripeCustomerId}`);
  const { data, error } = await db.from("entitlements").update({ stripe_customer_id: customer }).eq("user_id", id).is("stripe_customer_id", null).select(ENTITLEMENT_COLUMNS).maybeSingle();
  if (error) throw dbError("Could not set Stripe customer", error);
  if (!data) throw new DbError(`Stripe customer of ${id} changed concurrently`);
  return toEntitlement(data);
}

export type EntitlementRefusal = "limit" | "ended";

/** The trigger `companies_within_entitlement` refused a company: the plan's limit is reached, or the subscription has ended. */
export class EntitlementError extends DbError {
  constructor(
    message: string,
    readonly reason: EntitlementRefusal,
    readonly limit: number | null,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "EntitlementError";
  }
}

const RefusalSchema = z.object({ code: z.literal("23514"), message: z.string(), hint: z.enum(["entitlement_limit", "entitlement_ended"]) });

/** The `EntitlementError` a PostgREST error stands for, or null when it is something else. */
export function entitlementErrorFrom(error: unknown): EntitlementError | null {
  const parsed = RefusalSchema.safeParse(error);
  if (!parsed.success) return null;
  const message = parsed.data.message.replace(/^entitlement:\s*/, "");
  if (parsed.data.hint === "entitlement_ended") return new EntitlementError(message, "ended", null, error);
  const limit = /includes (\d+) compan/.exec(message)?.[1];
  return new EntitlementError(`${message}.`, "limit", limit === undefined ? null : Number(limit), error);
}
