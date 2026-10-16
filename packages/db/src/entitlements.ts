import { ENTITLEMENT_STATUSES, EntitlementSchema, SUBSCRIPTION_PLAN_IDS, type Entitlement } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";
import { readAllPages } from "./paging";

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

/** The fields a concurrent writer changes (no timestamp: the trial's are microseconds the ISO form drops); a compare-and-set checks them. */
export type EntitlementExpectation = Partial<Pick<Entitlement, "status" | "planId" | "stripeCustomerId" | "stripeSubscriptionId" | "lastEventCreated" | "purgeDue">>;

const EXPECTED_COLUMNS = {
  status: "status",
  planId: "plan_id",
  stripeCustomerId: "stripe_customer_id",
  stripeSubscriptionId: "stripe_subscription_id",
  lastEventCreated: "last_event_created",
  purgeDue: "purge_due",
} as const satisfies Record<keyof EntitlementExpectation, string>;

/** The row as it was read, as an expectation: every field another writer may have changed since. */
export const expectationOf = (e: Entitlement): EntitlementExpectation => ({ status: e.status, planId: e.planId, stripeCustomerId: e.stripeCustomerId, stripeSubscriptionId: e.stripeSubscriptionId, lastEventCreated: e.lastEventCreated, purgeDue: e.purgeDue });

/**
 * Worker only (M6 review L10): writes the entitlement only while its row
 * still matches `expect`, never a blind upsert of a stale copy. Returns the
 * row written, or null when the row changed (or does not exist).
 */
export async function updateEntitlementIf(db: DbClient, entitlement: Entitlement, expect: EntitlementExpectation): Promise<Entitlement | null> {
  const e = EntitlementSchema.parse(entitlement);
  const { user_id: userId, ...row } = toRow(e);
  let query = db.from("entitlements").update(row).eq("user_id", userId);
  for (const [field, column] of Object.entries(EXPECTED_COLUMNS) as [keyof EntitlementExpectation, string][]) {
    if (!(field in expect)) continue;
    const value = expect[field];
    query = value === null ? query.is(column, null) : query.eq(column, value as string | number | boolean);
  }
  const { data, error } = await query.select(ENTITLEMENT_COLUMNS).maybeSingle();
  if (error) throw dbError("Could not store entitlement", error);
  return data ? toEntitlement(data) : null;
}

/** The row changed between the read and the write (a tick, the retention sweep, the customer write): the step retries on a fresh read. */
export class EntitlementConflictError extends DbError {
  constructor(userId: string) {
    super(`Entitlement of ${userId} changed since it was read; not written`);
    this.name = "EntitlementConflictError";
  }
}

/** Worker only: stores the projection of `before` as `after`, refused with `EntitlementConflictError` when the row is no longer `before`. */
export async function saveEntitlement(db: DbClient, before: Entitlement, after: Entitlement): Promise<Entitlement> {
  const saved = await updateEntitlementIf(db, after, expectationOf(before));
  if (!saved) throw new EntitlementConflictError(before.userId);
  return saved;
}

/** Every row of an entitlement list, in pages under PostgREST's `max_rows` (the order ends on `user_id`, unique). */
const allRows = async (what: string, page: (from: number, to: number) => PromiseLike<{ readonly data: readonly unknown[] | null; readonly error: unknown }>): Promise<readonly Entitlement[]> =>
  Object.freeze((await readAllPages(page, what)).map(toEntitlement));

/**
 * `entitlements-tick` (M6 review M1): rows following a subscription that is
 * not ended, whose `cancel_at` (else `period_end`) is at or before `cutoff`
 * (the tick passes now − 3 days): the webhook that should have moved them
 * did not come, so the worker asks the provider. Oldest first, every page.
 */
export function listEntitlementsToReconcile(db: DbClient, cutoff: Date): Promise<readonly Entitlement[]> {
  const at = cutoff.toISOString();
  return allRows("Could not list entitlements to reconcile", (from, to) =>
    db
      .from("entitlements")
      .select(ENTITLEMENT_COLUMNS)
      .in("status", ["trialing", "active", "past_due", "canceled"])
      .not("stripe_subscription_id", "is", null)
      .or(`cancel_at.lte.${at},and(cancel_at.is.null,period_end.lte.${at})`)
      .order("period_end", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to),
  );
}

/**
 * `entitlements-tick`'s heal: rows on a priced subscription whose current
 * period started at or before `startedBefore` (the tick passes now − 24 h,
 * time for a failed renewal to have gone `past_due`) and is still running:
 * `active`, or `canceled` at the period end (its period was paid) while
 * `period_end` and any `cancel_at` are after `now`. Every page.
 */
export function listEntitlementsToHeal(db: DbClient, startedBefore: Date, now: Date): Promise<readonly Entitlement[]> {
  const at = now.toISOString();
  return allRows("Could not list entitlements to heal", (from, to) =>
    db
      .from("entitlements")
      .select(ENTITLEMENT_COLUMNS)
      .or(`status.eq.active,and(status.eq.canceled,period_end.gt.${at},or(cancel_at.is.null,cancel_at.gt.${at}))`)
      .gt("price_usd", 0)
      .not("stripe_subscription_id", "is", null)
      .lte("period_start", startedBefore.toISOString())
      .order("user_id", { ascending: true })
      .range(from, to),
  );
}

/** `entitlements-tick`: trials past their period end with no subscription, oldest first, every page. */
export function listTrialsToEnd(db: DbClient, now: Date): Promise<readonly Entitlement[]> {
  return allRows("Could not list trials to end", (from, to) =>
    db.from("entitlements").select(ENTITLEMENT_COLUMNS).eq("status", "trialing").is("stripe_subscription_id", null).lte("period_end", now.toISOString()).order("period_end", { ascending: true }).order("user_id", { ascending: true }).range(from, to),
  );
}

/** `retention-sweep`: ended entitlements whose retention has passed, purge-due ones included, oldest first, every page. */
export function listRetentionDue(db: DbClient, now: Date): Promise<readonly Entitlement[]> {
  return allRows("Could not list retention due", (from, to) =>
    db.from("entitlements").select(ENTITLEMENT_COLUMNS).eq("status", "ended").lte("retention_until", now.toISOString()).order("retention_until", { ascending: true }).order("user_id", { ascending: true }).range(from, to),
  );
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
