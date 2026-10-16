"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deactivateAutoRule, removePushSubscription, updateProfile, upsertPushSubscription } from "@north/db";
import { createClient, currentUser } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/(app)/c/[slug]/decisions/actions";
import { withError, type ErrorCode } from "@/lib/page-errors";

/** M6 review L8: the page maps the code to its fixed line. */
const settingsUrl = (outcome: { saved?: true; error?: ErrorCode<"settings"> }): string =>
  outcome.error ? withError("/settings", "settings", outcome.error) : outcome.saved ? "/settings?saved=1" : "/settings";

/** Fixed messages for the browser; the cause goes to the server log only. */
const message = (error: unknown, fallback: string): string => {
  console.error("[settings]", fallback, error);
  return fallback;
};

/** The brief hour arrives as a select value; anything but a whole hour 0..23 is refused before the repository (which checks again). */
const BriefHourSchema = z.coerce.number().int().min(0).max(23);

/** Quota (1-5), time zone and brief hour (0-23), validated by the repository before any write (DEC-3, BRF-1). */
export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const quota = Number(String(formData.get("dailyDecisionQuota") ?? ""));
  const timezone = String(formData.get("timezone") ?? "").trim();
  const rawHour = formData.get("briefHour");
  const briefHour = rawHour === null ? undefined : BriefHourSchema.safeParse(String(rawHour));
  const db = await createClient();
  let error: ErrorCode<"settings"> | null = null;
  try {
    if (briefHour !== undefined && !briefHour.success) throw new Error("brief hour out of range");
    await updateProfile(db, user.id, { dailyDecisionQuota: quota, timezone, ...(briefHour?.success ? { briefHour: briefHour.data } : {}) });
  } catch (cause) {
    console.error("[settings] could not save the profile", cause);
    error = "save-failed";
  }
  revalidatePath("/settings");
  redirect(settingsUrl(error ? { error } : { saved: true }));
}

const SubscriptionSchema = z.object({ endpoint: z.string().url().max(2048), p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) });
export type SubscriptionInput = z.input<typeof SubscriptionSchema>;

/** Stores the browser's push subscription for the signed-in user (DEC-2 delivery). */
export async function savePushSubscriptionAction(input: SubscriptionInput): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = SubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid subscription" };
  try {
    await upsertPushSubscription(await createClient(), { userId: user.id, ...parsed.data });
  } catch (error) {
    return { ok: false, error: message(error, "Could not save the subscription") };
  }
  return { ok: true, value: undefined };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  try {
    await removePushSubscription(await createClient(), user.id, endpoint);
  } catch (error) {
    return { ok: false, error: message(error, "Could not remove the subscription") };
  }
  return { ok: true, value: undefined };
}

const DeactivateSchema = z.object({ companyId: z.string().uuid(), ruleId: z.string().uuid() });

/** Switches an auto rule off; the rule row stays for the audit trail. */
export async function deactivateAutoRuleAction(input: z.input<typeof DeactivateSchema>): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = DeactivateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await deactivateAutoRule(await createClient(), parsed.data.companyId, parsed.data.ruleId);
  } catch (error) {
    return { ok: false, error: message(error, "Could not deactivate the rule") };
  }
  revalidatePath("/settings");
  return { ok: true, value: undefined };
}
