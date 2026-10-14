"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setKillSwitch } from "@north/db";
import { EVENT } from "@north/core/events";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

const InputSchema = z.object({ companyId: z.string().uuid(), active: z.boolean(), slug: z.string().min(1) });

/** Kill switch (every screen): flips the flag under RLS and notifies the worker. */
export async function toggleKillSwitchAction(input: { companyId: string; active: boolean; slug: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  try {
    await setKillSwitch(supabase, parsed.data.companyId, parsed.data.active);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update" };
  }
  await inngest.send({
    name: parsed.data.active ? EVENT.companyKillSwitch : EVENT.companyResume,
    data: { companyId: parsed.data.companyId },
  });
  revalidatePath(`/c/${parsed.data.slug}`);
  return { ok: true };
}
