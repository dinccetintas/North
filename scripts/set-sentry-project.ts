/**
 * PRO-2 (M5 review M4, deferred to M7): which Sentry project's issues become
 * fix tasks for a company. The slug is service-role-only since migration 0011
 * (a claim until a Sentry connection proves ownership, the first item of M7),
 * so the founder sets their own company's slug here, once, from their shell.
 *
 * Usage:
 *   pnpm sentry:project -- <company-slug> <sentry-project-slug>
 *   pnpm sentry:project -- <company-slug> --unset
 * Needs the worker's SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the shell
 * (never in a file); the Sentry webhook then matches `project.slug` to it.
 */
import { getCompanyBySlug, SentryProjectSlugSchema, serviceClientFromEnv, setSentryProject } from "@north/db";

const COMPANY_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

async function main(): Promise<void> {
  const [companySlug = "", target = ""] = process.argv.slice(2).filter((a) => a !== "--");
  if (!COMPANY_SLUG.test(companySlug) || target === "") throw new Error("usage: pnpm sentry:project -- <company-slug> <sentry-project-slug>|--unset");
  const slug = target === "--unset" ? null : SentryProjectSlugSchema.parse(target);
  const db = serviceClientFromEnv();
  const company = await getCompanyBySlug(db, companySlug);
  if (!company) throw new Error(`no company with slug ${companySlug}`);
  const { data: before } = await db.from("companies").select("sentry_project_slug").eq("id", company.id).maybeSingle();
  await setSentryProject(db, company.id, slug);
  console.log(`[sentry:project] ${company.slug} (${company.id}): ${before?.sentry_project_slug ?? "none"} → ${slug ?? "none"}`);
}

main().catch((error: unknown) => {
  console.error(`sentry:project: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
