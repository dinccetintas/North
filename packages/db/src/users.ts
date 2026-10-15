import { QuotaSchema } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";

/** The founder's profile: where they are (for the brief), when the brief comes and how many decisions a day they accept. */
export interface ProfileRecord {
  readonly id: string;
  readonly email: string;
  readonly timezone: string;
  readonly dailyDecisionQuota: number;
  /** BRF-1 (M6): the owner-local hour of the morning brief, 0-23. */
  readonly briefHour: number;
  /** A mirror of `entitlements.plan_id` kept by a trigger; read the entitlement for anything that matters. */
  readonly plan: string;
}

const isKnownTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const TimezoneSchema = z.string().trim().min(1).max(64).refine(isKnownTimezone, { message: "unknown IANA time zone" });

/** BRF-1: the owner-local hour of the brief; mirrors the `users.brief_hour` check. */
export const BriefHourSchema = z.number().int().min(0).max(23);

export const UpdateProfileInputSchema = z
  .object({
    timezone: TimezoneSchema.optional(),
    dailyDecisionQuota: QuotaSchema.optional(),
    briefHour: BriefHourSchema.optional(),
  })
  .refine((patch) => patch.timezone !== undefined || patch.dailyDecisionQuota !== undefined || patch.briefHour !== undefined, { message: "nothing to update" });
export type UpdateProfileInput = z.input<typeof UpdateProfileInputSchema>;

const PROFILE_COLUMNS = "id, email, timezone, daily_decision_quota, brief_hour, plan";

const toProfile = (row: { id: string; email: string; timezone: string; daily_decision_quota: number; brief_hour: number; plan: string }): ProfileRecord =>
  Object.freeze({ id: row.id, email: row.email, timezone: row.timezone, dailyDecisionQuota: row.daily_decision_quota, briefHour: row.brief_hour, plan: row.plan });

/** The profile auto-created on sign-up, or null when unknown or not visible (profiles are private). */
export async function getProfile(db: DbClient, userId: string): Promise<ProfileRecord | null> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.from("users").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load profile", error);
  return data ? toProfile(data) : null;
}

/** Settings: quota within 1..5 (DEC-3), an IANA time zone and the brief hour 0..23 (BRF-1). Validated before any write. */
export async function updateProfile(db: DbClient, userId: string, input: UpdateProfileInput): Promise<ProfileRecord> {
  const id = UuidSchema.parse(userId);
  const patch = UpdateProfileInputSchema.parse(input);
  const { data, error } = await db
    .from("users")
    .update({
      ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
      ...(patch.dailyDecisionQuota === undefined ? {} : { daily_decision_quota: patch.dailyDecisionQuota }),
      ...(patch.briefHour === undefined ? {} : { brief_hour: patch.briefHour }),
    })
    .eq("id", id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw dbError("Could not update profile", error);
  if (!data) throw new DbError(`Profile ${id} not found or not yours to change`);
  return toProfile(data);
}
