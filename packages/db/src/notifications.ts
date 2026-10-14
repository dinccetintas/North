import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { isJsonObject, toJson, UuidSchema } from "./json";

export const NOTIFICATION_CHANNELS = ["push", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ["sent", "failed", "sandbox"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface NotificationRecord {
  readonly id: string;
  readonly companyId: string;
  readonly userId: string;
  readonly channel: NotificationChannel;
  readonly kind: string;
  readonly cardId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: NotificationStatus;
  readonly createdAt: string;
}

export const RecordNotificationInputSchema = z.object({
  companyId: UuidSchema,
  userId: UuidSchema,
  channel: z.enum(NOTIFICATION_CHANNELS),
  kind: z.string().trim().min(1).max(100),
  cardId: UuidSchema.optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(NOTIFICATION_STATUSES),
});
export type RecordNotificationInput = z.input<typeof RecordNotificationInputSchema>;

const NOTIFICATION_COLUMNS = "id, company_id, user_id, channel, kind, card_id, payload, status, created_at";

const NotificationRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  user_id: z.string(),
  channel: z.enum(NOTIFICATION_CHANNELS),
  kind: z.string(),
  card_id: z.string().nullable(),
  payload: z.unknown(),
  status: z.enum(NOTIFICATION_STATUSES),
  created_at: z.string(),
});

const toRecord = (row: unknown): NotificationRecord => {
  const r = NotificationRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    userId: r.user_id,
    channel: r.channel,
    kind: r.kind,
    cardId: r.card_id,
    payload: Object.freeze(isJsonObject(r.payload) ? { ...r.payload } : {}),
    status: r.status,
    createdAt: r.created_at,
  });
};

/** Logs one delivery attempt (DEC-2). Only the worker writes; owners read their company's log. */
export async function recordNotification(db: DbClient, input: RecordNotificationInput): Promise<string> {
  const n = RecordNotificationInputSchema.parse(input);
  const { data, error } = await db
    .from("notifications")
    .insert({ company_id: n.companyId, user_id: n.userId, channel: n.channel, kind: n.kind, card_id: n.cardId ?? null, payload: toJson(n.payload), status: n.status })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not record notification", error);
  return data.id;
}

/** Newest notifications first. */
export async function listNotifications(db: DbClient, companyId: string, limit = 50): Promise<readonly NotificationRecord[]> {
  const id = UuidSchema.parse(companyId);
  const max = z.number().int().positive().max(500).parse(limit);
  const { data, error } = await db.from("notifications").select(NOTIFICATION_COLUMNS).eq("company_id", id).order("created_at", { ascending: false }).limit(max);
  if (error) throw dbError("Could not list notifications", error);
  return Object.freeze((data ?? []).map(toRecord));
}
