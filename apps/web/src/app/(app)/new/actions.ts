"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCompany, CreateCompanyInputSchema } from "@north/db";
import { EVENT } from "@north/core/events";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

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
  const company = await createCompany(supabase, parsed.data);
  await inngest.send({ name: EVENT.companyCreated, data: { companyId: company.id } });
  revalidatePath("/companies");
  redirect(`/c/${company.slug}`);
}
