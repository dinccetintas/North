"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deactivateAutoRule, removePushSubscription, updateProfile, upsertPushSubscription } from "@north/db";
import { createClient, currentUser } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/(app)/c/[slug]/decisions/actions";

const settingsUrl = (outcome: { saved?: true; error?: string }): string =>
  outcome.error ? `/settings?error=${encodeURIComponent(outcome.error)}` : outcome.saved ? "/settings?saved=1" : "/settings";

const message = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/** Quota (1-5) and time zone, validated by the repository before any write (DEC-3). */
export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const quota = Number(String(formData.get("dailyDecisionQuota") ?? ""));
  const timezone = String(formData.get("timezone") ?? "").trim();
  const db = await createClient();
  let error: string | null = null;
  try {
    await updateProfile(db, user.id, { dailyDecisionQuota: quota, timezone });
  } catch (cause) {
    error = message(cause, "Could not save settings");
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
