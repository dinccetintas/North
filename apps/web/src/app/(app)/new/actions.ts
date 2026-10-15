"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCompany, CreateCompanyInputSchema, EntitlementError, getEntitlement, listCompanies, type CompanySummary } from "@north/db";
import { EVENT } from "@north/core/events";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { activeCompanyCount, newCompanyGate } from "@/lib/portfolio-view";

const newError = (message: string): never => redirect(`/new?error=${encodeURIComponent(message)}`);

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
    redirect(`/new?error=${encodeURIComponent("Give the company a name and a thesis of at least ten characters.")}`);
  }

  const supabase = await createClient();
  const company: CompanySummary = await createCompany(supabase, parsed.data).catch(async (error: unknown) => {
    // BIL-1: the trigger `companies_within_entitlement` refused; the owner reads the plan's own words, not the database's.
    if (!(error instanceof EntitlementError)) throw error;
    const [entitlement, companies] = await Promise.all([getEntitlement(supabase, user.id), listCompanies(supabase)]);
    return newError(newCompanyGate(entitlement, activeCompanyCount(companies)).reason ?? "Your plan does not include another company.");
  });
  await inngest.send({ name: EVENT.companyCreated, data: { companyId: company.id } });
  revalidatePath("/companies");
  redirect(`/c/${company.slug}/onboarding`);
}
