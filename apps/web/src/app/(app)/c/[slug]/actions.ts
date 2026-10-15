"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCompanyById, setKillSwitch } from "@north/db";
import { EVENT } from "@north/core/events";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { resumeRefusal } from "@/lib/kill-switch-guard";

const InputSchema = z.object({ companyId: z.string().uuid(), active: z.boolean(), slug: z.string().min(1) });

/**
 * Kill switch (every screen): flips the flag under RLS and notifies the
 * worker. M6 (ADR 0014): the owner's stop records `paused_reason = user` (a
 * database trigger; the column is not granted to owners); a
 * pause billing set (`subscription_ended`, `retention`) is not the owner's to
 * lift, so a resume is refused here as the worker refuses it too.
 */
export async function toggleKillSwitchAction(input: { companyId: string; active: boolean; slug: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  if (!parsed.data.active) {
    const refusal = resumeRefusal(await getCompanyById(supabase, parsed.data.companyId));
    if (refusal) return { ok: false, error: refusal };
  }
  try {
    // The owner's client passes no reason: `paused_reason` is not granted to owners and the trigger records `user`.
    await setKillSwitch(supabase, parsed.data.companyId, parsed.data.active);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update" };
  }
  await inngest.send({
    name: parsed.data.active ? EVENT.companyKillSwitch : EVENT.companyResume,
    data: { companyId: parsed.data.companyId },
  });
  revalidatePath(`/c/${parsed.data.slug}`, "layout");
  return { ok: true };
}
