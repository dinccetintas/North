import { cache } from "react";
import { getCompanyBySlug, type CompanySummary } from "@north/db";
import { createClient } from "@/lib/supabase/server";

/**
 * Company by slug under RLS, deduplicated per request so the layout and the
 * page share one query.
 */
export const companyBySlug = cache(async (slug: string): Promise<CompanySummary | null> => {
  const db = await createClient();
  return getCompanyBySlug(db, slug);
});
