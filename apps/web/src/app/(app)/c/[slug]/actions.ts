"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCompanyById, getEntitlement, setKillSwitch, setSenderIdentity } from "@north/db";
import { EVENT } from "@north/core/events";
import { SenderIdentitySchema } from "@north/core/outreach/policy";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { resumeRefusal } from "@/lib/kill-switch-guard";

const InputSchema = z.object({ companyId: z.string().uuid(), active: z.boolean(), slug: z.string().min(1) });

/** CMP-1: the identity half is core's `SenderIdentitySchema` (the one the outreach rules read it with), never a copy. */
const SenderIdentityInputSchema = SenderIdentitySchema.extend({ companyId: z.string().uuid(), slug: z.string().min(1) });

/** Fixed texts for the browser; a write failure's cause stays in the server log. */
const IDENTITY_TEXT = Object.freeze({
  legalName: "Enter the company's legal name (1 to 120 characters).",
  postalAddress: "Enter the company's full postal address (8 to 300 characters).",
  invalid: "Invalid input",
  failed: "Could not save the sender identity. Try again.",
});

/**
 * Kill switch (every screen): flips the flag under RLS and notifies the
 * worker. M6 (ADR 0014): the owner's stop records `paused_reason = user` (a
 * database trigger; the column is not granted to owners); a
 * pause billing set (`subscription_ended`, `retention`) is not the owner's to
 * lift, and no pause is while the owner's entitlement is ended, so a resume is
 * refused here as the database and the worker refuse it too. A failed write
 * shows a fixed line; the database's message (it names the company) is logged.
 */
export async function toggleKillSwitchAction(input: { companyId: string; active: boolean; slug: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  if (!parsed.data.active) {
    const [company, entitlement] = await Promise.all([getCompanyById(supabase, parsed.data.companyId), getEntitlement(supabase, user.id)]);
    const refusal = resumeRefusal(company, entitlement);
    if (refusal) return { ok: false, error: refusal };
  }
  try {
    // The owner's client passes no reason: `paused_reason` is not granted to owners and the trigger records `user`.
    await setKillSwitch(supabase, parsed.data.companyId, parsed.data.active);
  } catch (error) {
    console.error("[kill-switch] could not update", parsed.data.companyId, error);
    return { ok: false, error: parsed.data.active ? "Could not stop the agents. Try again." : "Could not resume the agents. Try again." };
  }
  await inngest.send({
    name: parsed.data.active ? EVENT.companyKillSwitch : EVENT.companyResume,
    data: { companyId: parsed.data.companyId },
  });
  revalidatePath(`/c/${parsed.data.slug}`, "layout");
  return { ok: true };
}

/** The fixed line for a refused identity: the first field the schema refused, never the schema's own message. */
function identityRefusal(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === "legalName") return IDENTITY_TEXT.legalName;
  if (field === "postalAddress") return IDENTITY_TEXT.postalAddress;
  return IDENTITY_TEXT.invalid;
}

/**
 * CMP-1 (M7), the Team page's "Sender identity" form: the company's legal
 * name and postal address, which the worker prints at the foot of every
 * first-contact email; without them the gate blocks every first contact
 * (`no_sender_identity`). Validated with core's `SenderIdentitySchema` and
 * written with the owner's own client, so RLS and the column grants (0019)
 * decide; RLS also refuses a company that is not the caller's. This is a
 * settings write inside North, not an action on the outside world, so it
 * does not pass `gate()`: the gate reads this identity when a send is asked
 * for. A failed write shows a fixed line; the database's message is logged.
 */
export async function saveSenderIdentity(input: { companyId: string; slug: string; legalName: string; postalAddress: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = SenderIdentityInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: identityRefusal(parsed.error) };

  const { companyId, slug, legalName, postalAddress } = parsed.data;
  const supabase = await createClient();
  try {
    await setSenderIdentity(supabase, companyId, { legalName, postalAddress });
  } catch (error) {
    console.error("[sender-identity] could not save", companyId, error);
    return { ok: false, error: IDENTITY_TEXT.failed };
  }
  revalidatePath(`/c/${slug}/team`);
  return { ok: true };
}
