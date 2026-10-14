import { QuotaSchema } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";

/** The founder's profile: where they are (for the brief) and how many decisions a day they accept. */
export interface ProfileRecord {
  readonly id: string;
  readonly email: string;
  readonly timezone: string;
  readonly dailyDecisionQuota: number;
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

export const UpdateProfileInputSchema = z
  .object({
    timezone: TimezoneSchema.optional(),
    dailyDecisionQuota: QuotaSchema.optional(),
  })
  .refine((patch) => patch.timezone !== undefined || patch.dailyDecisionQuota !== undefined, { message: "nothing to update" });
export type UpdateProfileInput = z.input<typeof UpdateProfileInputSchema>;

const PROFILE_COLUMNS = "id, email, timezone, daily_decision_quota, plan";

const toProfile = (row: { id: string; email: string; timezone: string; daily_decision_quota: number; plan: string }): ProfileRecord =>
  Object.freeze({ id: row.id, email: row.email, timezone: row.timezone, dailyDecisionQuota: row.daily_decision_quota, plan: row.plan });

/** The profile auto-created on sign-up, or null when unknown or not visible (profiles are private). */
export async function getProfile(db: DbClient, userId: string): Promise<ProfileRecord | null> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.from("users").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load profile", error);
  return data ? toProfile(data) : null;
}

/** Settings: quota within 1..5 (DEC-3) and an IANA time zone. Validated before any write. */
export async function updateProfile(db: DbClient, userId: string, input: UpdateProfileInput): Promise<ProfileRecord> {
  const id = UuidSchema.parse(userId);
  const patch = UpdateProfileInputSchema.parse(input);
  const { data, error } = await db
    .from("users")
    .update({
      ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
      ...(patch.dailyDecisionQuota === undefined ? {} : { daily_decision_quota: patch.dailyDecisionQuota }),
    })
    .eq("id", id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw dbError("Could not update profile", error);
  if (!data) throw new DbError(`Profile ${id} not found or not yours to change`);
  return toProfile(data);
}
