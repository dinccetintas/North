import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";

/** A browser push subscription (endpoint plus the two encryption keys the push service needs). */
export interface PushSubscriptionRecord {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export const UpsertPushSubscriptionInputSchema = z.object({
  userId: UuidSchema,
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
});
export type UpsertPushSubscriptionInput = z.input<typeof UpsertPushSubscriptionInputSchema>;

const SUBSCRIPTION_COLUMNS = "endpoint, p256dh, auth";

const toRecord = (row: { endpoint: string; p256dh: string; auth: string }): PushSubscriptionRecord =>
  Object.freeze({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });

/** Stores or refreshes one browser's subscription. Endpoints are unique, so re-subscribing updates the keys in place. */
export async function upsertPushSubscription(db: DbClient, input: UpsertPushSubscriptionInput): Promise<void> {
  const s = UpsertPushSubscriptionInputSchema.parse(input);
  const { error } = await db
    .from("push_subscriptions")
    .upsert({ user_id: s.userId, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { onConflict: "endpoint" });
  if (error) throw dbError("Could not save push subscription", error);
}

/** Every subscription of a user, oldest first. Under RLS a user only ever sees their own. */
export async function listPushSubscriptions(db: DbClient, userId: string): Promise<readonly PushSubscriptionRecord[]> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.from("push_subscriptions").select(SUBSCRIPTION_COLUMNS).eq("user_id", id).order("created_at", { ascending: true });
  if (error) throw dbError("Could not list push subscriptions", error);
  return Object.freeze((data ?? []).map(toRecord));
}

/** Removes one endpoint for the user; a missing row is not an error (the browser may already have unsubscribed). */
export async function removePushSubscription(db: DbClient, userId: string, endpoint: string): Promise<void> {
  const id = UuidSchema.parse(userId);
  const url = z.string().url().parse(endpoint);
  const { error } = await db.from("push_subscriptions").delete().eq("user_id", id).eq("endpoint", url);
  if (error) throw dbError("Could not remove push subscription", error);
}
