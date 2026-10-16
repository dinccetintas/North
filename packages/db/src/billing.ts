import { BILLING_EVENT_TYPES, packById, SUBSCRIPTION_PLAN_IDS, UNKNOWN_BILLING_EVENT_DAYS, type BillingEventType, type SubscriptionPlanId } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { isJsonObject, toJson, UuidSchema } from "./json";
import type { TablesUpdate } from "./types";

/**
 * BIL-1 (ADR 0014): the web never holds a Stripe key. The owner inserts a
 * `requested` billing session; the worker creates the provider session and
 * writes its URL (or a fixed failure), and `completed_at` once the session's
 * own checkout event is applied. Every accepted Stripe event is stored in
 * `billing_events` (append-only, unique by the Stripe event id) before it is
 * applied, so a replay is a duplicate: the reduced event core parsed and the
 * sha256 of the raw body, never the raw body (M6 review L2).
 */
export const BILLING_SESSION_KINDS = ["checkout", "portal", "credit_pack"] as const;
export type BillingSessionKind = (typeof BILLING_SESSION_KINDS)[number];
export const BILLING_SESSION_STATUSES = ["requested", "ready", "failed"] as const;
export type BillingSessionStatus = (typeof BILLING_SESSION_STATUSES)[number];

export interface BillingSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly kind: BillingSessionKind;
  readonly planId: SubscriptionPlanId | null;
  readonly packId: string | null;
  readonly status: BillingSessionStatus;
  readonly url: string | null;
  readonly providerRef: string | null;
  readonly error: string | null;
  /** The session's checkout event was applied (L10: it no longer holds a second checkout back). */
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const PackIdSchema = z.string().refine((id) => packById(id) !== null, { message: "unknown credit pack" });

export const CreateBillingSessionInputSchema = z.discriminatedUnion("kind", [
  z.object({ userId: UuidSchema, kind: z.literal("checkout"), planId: z.enum(SUBSCRIPTION_PLAN_IDS) }),
  z.object({ userId: UuidSchema, kind: z.literal("portal") }),
  z.object({ userId: UuidSchema, kind: z.literal("credit_pack"), packId: PackIdSchema }),
]);
export type CreateBillingSessionInput = z.input<typeof CreateBillingSessionInputSchema>;

const SESSION_COLUMNS = "id, user_id, kind, plan_id, pack_id, status, url, provider_ref, error, completed_at, created_at, updated_at";

const SessionRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: z.enum(BILLING_SESSION_KINDS),
  plan_id: z.enum(SUBSCRIPTION_PLAN_IDS).nullable(),
  pack_id: z.string().nullable(),
  status: z.enum(BILLING_SESSION_STATUSES),
  url: z.string().nullable(),
  provider_ref: z.string().nullable(),
  error: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const toSession = (row: unknown): BillingSessionRecord => {
  const r = SessionRowSchema.parse(row);
  return Object.freeze({ id: r.id, userId: r.user_id, kind: r.kind, planId: r.plan_id, packId: r.pack_id, status: r.status, url: r.url, providerRef: r.provider_ref, error: r.error, completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at });
};

/** The owner's client: a `requested` session (the insert policy allows nothing else). The worker is told through `billing/session_requested`. */
export async function createBillingSession(db: DbClient, input: CreateBillingSessionInput): Promise<BillingSessionRecord> {
  const s = CreateBillingSessionInputSchema.parse(input);
  const row = { user_id: s.userId, kind: s.kind, plan_id: s.kind === "checkout" ? s.planId : null, pack_id: s.kind === "credit_pack" ? s.packId : null };
  const { data, error } = await db.from("billing_sessions").insert(row).select(SESSION_COLUMNS).single();
  if (error || !data) throw dbError("Could not request a billing session", error);
  return toSession(data);
}

/** One session, or null when unknown or not the caller's. */
export async function getBillingSession(db: DbClient, sessionId: string): Promise<BillingSessionRecord | null> {
  const id = UuidSchema.parse(sessionId);
  const { data, error } = await db.from("billing_sessions").select(SESSION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load billing session", error);
  return data ? toSession(data) : null;
}

const SessionUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }, "an http(s) URL without credentials");

export const BillingSessionReadySchema = z.object({ url: SessionUrlSchema, providerRef: z.string().min(1).max(200).nullable() });
export type BillingSessionReady = z.input<typeof BillingSessionReadySchema>;

async function settleSession(db: DbClient, sessionId: string, patch: TablesUpdate<"billing_sessions">, accept: BillingSessionStatus): Promise<BillingSessionRecord> {
  const id = UuidSchema.parse(sessionId);
  const { data, error } = await db.from("billing_sessions").update(patch).eq("id", id).eq("status", "requested").select(SESSION_COLUMNS).maybeSingle();
  if (error) throw dbError("Could not settle billing session", error);
  if (data) return toSession(data);
  const current = await getBillingSession(db, id);
  if (current?.status === accept) return current;
  throw new DbError(`Billing session ${id} is not requested (status ${current?.status ?? "unknown"})`);
}

/** Worker only: the provider session exists; the page redirects to `url`. Idempotent: a session already `ready` is returned unchanged. */
export async function setBillingSessionReady(db: DbClient, sessionId: string, ready: BillingSessionReady): Promise<BillingSessionRecord> {
  const r = BillingSessionReadySchema.parse(ready);
  return settleSession(db, sessionId, { status: "ready", url: r.url, provider_ref: r.providerRef }, "ready");
}

/** Worker only: a fixed, user-readable failure (never the provider's body). */
export async function setBillingSessionFailed(db: DbClient, sessionId: string, message: string): Promise<BillingSessionRecord> {
  const m = z.string().trim().min(1).max(300).parse(message);
  return settleSession(db, sessionId, { status: "failed", error: m }, "failed");
}

const ProviderRefSchema = z.string().min(1).max(200);

/** L1: the session the worker created for a provider session id (`cs_…`), the newest when several share it; null when none. */
export async function findBillingSessionByProviderRef(db: DbClient, providerRef: string): Promise<BillingSessionRecord | null> {
  const ref = ProviderRefSchema.safeParse(providerRef);
  if (!ref.success) return null;
  const { data, error } = await db.from("billing_sessions").select(SESSION_COLUMNS).eq("provider_ref", ref.data).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw dbError("Could not find billing session", error);
  return data ? toSession(data) : null;
}

/** Worker only (L10): the session's checkout event was applied. True when this call set `completed_at` (written once). */
export async function markBillingSessionCompleted(db: DbClient, providerRef: string): Promise<boolean> {
  const ref = ProviderRefSchema.safeParse(providerRef);
  if (!ref.success) return false;
  const { data, error } = await db.from("billing_sessions").update({ completed_at: new Date().toISOString() }).eq("provider_ref", ref.data).is("completed_at", null).select("id");
  if (error) throw dbError("Could not mark billing session completed", error);
  return (data ?? []).length > 0;
}

/** L10: the user's subscription checkouts that are open: `ready` since `since`, their checkout event not applied yet. Newest first. */
export async function listOpenCheckouts(db: DbClient, userId: string, since: Date): Promise<readonly BillingSessionRecord[]> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db
    .from("billing_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", id)
    .eq("kind", "checkout")
    .eq("status", "ready")
    .is("completed_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw dbError("Could not list open checkouts", error);
  return Object.freeze((data ?? []).map(toSession));
}

export interface BillingEventRecord {
  readonly id: string;
  readonly eventId: string;
  readonly type: BillingEventType;
  readonly userId: string | null;
  /** The verified event as core's `parseBillingEvent` reduced it; the worker parses it again with the same schema. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** sha256 (hex) of the raw signed body; null for rows stored before 0016. */
  readonly payloadSha256: string | null;
  readonly receivedAt: string;
  readonly appliedAt: string | null;
}

export const InsertBillingEventInputSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  type: z.enum(BILLING_EVENT_TYPES),
  userId: UuidSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/, "a hex sha256"),
});
export type InsertBillingEventInput = z.input<typeof InsertBillingEventInputSchema>;

const EVENT_COLUMNS = "id, event_id, type, user_id, payload, payload_sha256, received_at, applied_at";

const EventRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  type: z.enum(BILLING_EVENT_TYPES),
  user_id: z.string().nullable(),
  payload: z.unknown().refine(isJsonObject, "payload is an object"),
  payload_sha256: z.string().nullable(),
  received_at: z.string(),
  applied_at: z.string().nullable(),
});

const toEvent = (row: unknown): BillingEventRecord => {
  const r = EventRowSchema.parse(row);
  return Object.freeze({ id: r.id, eventId: r.event_id, type: r.type, userId: r.user_id, payload: r.payload as Readonly<Record<string, unknown>>, payloadSha256: r.payload_sha256, receivedAt: r.received_at, appliedAt: r.applied_at });
};

/** Worker only: stores a verified event once. A replayed Stripe event id returns the first row with `duplicate: true` and writes nothing. */
export async function insertBillingEvent(db: DbClient, input: InsertBillingEventInput): Promise<{ readonly id: string; readonly duplicate: boolean }> {
  const e = InsertBillingEventInputSchema.parse(input);
  const { data, error } = await db.from("billing_events").insert({ event_id: e.eventId, type: e.type, user_id: e.userId, payload: toJson(e.payload), payload_sha256: e.payloadSha256 }).select("id").single();
  if (error?.code === "23505") {
    const existing = await db.from("billing_events").select("id").eq("event_id", e.eventId).maybeSingle();
    if (existing.error || !existing.data) throw dbError("Could not load the duplicate billing event", existing.error ?? error);
    return Object.freeze({ id: existing.data.id, duplicate: true });
  }
  if (error || !data) throw dbError("Could not store billing event", error);
  return Object.freeze({ id: data.id, duplicate: false });
}

/** Worker only: the projection ran. True when this call set `applied_at`, false when it was already set (the column is written once). */
export async function markBillingEventApplied(db: DbClient, billingEventId: string): Promise<boolean> {
  const id = UuidSchema.parse(billingEventId);
  const { data, error } = await db.from("billing_events").update({ applied_at: new Date().toISOString() }).eq("id", id).is("applied_at", null).select("id").maybeSingle();
  if (error) throw dbError("Could not mark billing event applied", error);
  return data !== null;
}

/** One stored event, or null (owners never read events). */
export async function getBillingEvent(db: DbClient, billingEventId: string): Promise<BillingEventRecord | null> {
  const id = UuidSchema.parse(billingEventId);
  const { data, error } = await db.from("billing_events").select(EVENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    if (error.code === "42501") return null;
    throw dbError("Could not load billing event", error);
  }
  return data ? toEvent(data) : null;
}

const DAY_MS = 86_400_000;

/**
 * Worker only, the retention sweep (L2): stored events no user owns (an
 * unknown customer) and never applied are removed `UNKNOWN_BILLING_EVENT_DAYS`
 * after `now`'s cutoff; the database never removes one younger than that on
 * its own clock. Returns the number removed.
 */
export async function sweepUnknownBillingEvents(db: DbClient, now: Date): Promise<number> {
  const before = new Date(now.getTime() - UNKNOWN_BILLING_EVENT_DAYS * DAY_MS).toISOString();
  const { data, error } = await db.rpc("billing_events_sweep_unknown", { p_before: before });
  if (error) throw dbError("Could not sweep unknown billing events", error);
  return z.number().int().nonnegative().parse(data);
}
