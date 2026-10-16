"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCompany, CreateCompanyInputSchema, EntitlementError, type CompanySummary } from "@north/db";
import { EVENT } from "@north/core/events";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { withError, type ErrorCode } from "@/lib/page-errors";

/** M6 review L8: an error code; the page writes the line (the plan limit in the plan's own words). */
const newError = (code: ErrorCode<"newCompany">): never => redirect(withError("/new", "newCompany", code));

export async function createCompanyAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const parsed = CreateCompanyInputSchema.safeParse({
    ownerId: user.id,
    name: formData.get("name"),
    thesis: formData.get("thesis"),
    targetCustomer: formData.get("targetCustomer") ?? "",
    whyNow: formData.get("whyNow") ?? "",
  });
  if (!parsed.success) {
    redirect(withError("/new", "newCompany", "invalid-company"));
  }

  const supabase = await createClient();
  const company: CompanySummary = await createCompany(supabase, parsed.data).catch((error: unknown) => {
    // BIL-1: the trigger `companies_within_entitlement` refused; the page shows the plan's own words (its gate), not the database's.
    if (!(error instanceof EntitlementError)) throw error;
    return newError("plan-limit");
  });
  await inngest.send({ name: EVENT.companyCreated, data: { companyId: company.id } });
  revalidatePath("/companies");
  redirect(`/c/${company.slug}/onboarding`);
}
