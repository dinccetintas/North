"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCompanyBySlug, setPublicPageEnabled, upsertPublicPage } from "@north/db";
import { PublicPageSchema } from "@north/core/public-page";
import { createClient, currentUser } from "@/lib/supabase/server";
import { withError, type ErrorCode } from "@/lib/page-errors";

/**
 * PUB-1: the owner writes the page (core schema: headline ≤ 120, blurb ≤ 600,
 * at most three outcome metrics) and flips the switch, both under RLS. The
 * company is found by slug with the owner's client, so a forged slug finds
 * nothing. The public route is revalidated so a disabled page is gone now.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** M6 review L8: the page maps the code to its fixed line. */
const pageUrl = (slug: string, outcome: { saved?: true; error?: ErrorCode<"publicPage"> }): string =>
  outcome.error ? withError(`/c/${slug}/public`, "publicPage", outcome.error) : `/c/${slug}/public${outcome.saved ? "?saved=1" : ""}`;

const checked = (formData: FormData, name: string): boolean => formData.get(name) === "on";

export async function savePublicPageAction(slug: string, formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!SLUG_RE.test(slug)) redirect("/companies");
  const db = await createClient();
  const company = await getCompanyBySlug(db, slug);
  if (!company) redirect("/companies");

  const parsed = PublicPageSchema.safeParse({
    headline: String(formData.get("headline") ?? ""),
    blurb: String(formData.get("blurb") ?? ""),
    showGoal: checked(formData, "showGoal"),
    metricKeys: formData.getAll("metricKeys").map(String),
    showSiteLink: checked(formData, "showSiteLink"),
    listed: checked(formData, "listed"),
  });
  if (!parsed.success) redirect(pageUrl(slug, { error: "invalid-page" }));

  let error: ErrorCode<"publicPage"> | null = null;
  try {
    await upsertPublicPage(db, company.id, parsed.data);
    await setPublicPageEnabled(db, company.id, checked(formData, "enabled"));
  } catch (cause) {
    console.error("[public-page] save failed", company.id, cause);
    error = "save-failed";
  }
  revalidatePath(`/p/${slug}`);
  revalidatePath(`/c/${slug}/public`);
  redirect(pageUrl(slug, error ? { error } : { saved: true }));
}
