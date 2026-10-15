import { PublicPageSchema, PublicPageViewSchema, publicPageView as composePublicPageView, type PublicPage, type PublicPageView } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";

/**
 * PUB-1: a company's public page shows only what the owner chose. The owner
 * writes `public_pages` and flips `companies.public_page_enabled` (off by
 * default); anonymous readers get the page through `public_page_view(slug)`
 * (security definer, null unless enabled), never a table.
 */
const PAGE_COLUMNS = "headline, blurb, show_goal, metric_keys, show_site_link, listed";

const PageRowSchema = z.object({
  headline: z.string(),
  blurb: z.string(),
  show_goal: z.boolean(),
  metric_keys: z.array(z.string()),
  show_site_link: z.boolean(),
  listed: z.boolean(),
});

const toPage = (row: unknown): PublicPage => {
  const r = PageRowSchema.parse(row);
  const page = PublicPageSchema.parse({ headline: r.headline, blurb: r.blurb, showGoal: r.show_goal, metricKeys: r.metric_keys, showSiteLink: r.show_site_link, listed: r.listed });
  return Object.freeze({ ...page, metricKeys: Object.freeze([...page.metricKeys]) }) as PublicPage;
};

/** The owner's page settings, or null when none were saved (or the company is not the caller's). */
export async function getPublicPage(db: DbClient, companyId: string): Promise<PublicPage | null> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("public_pages").select(PAGE_COLUMNS).eq("company_id", id).maybeSingle();
  if (error) throw dbError("Could not load public page", error);
  return data ? toPage(data) : null;
}

/** The owner's client: saves the page through core's schema (strings sanitised, ≤ 3 outcome keys). Does not turn the page on. */
export async function upsertPublicPage(db: DbClient, companyId: string, page: z.input<typeof PublicPageSchema>): Promise<PublicPage> {
  const id = UuidSchema.parse(companyId);
  const p = PublicPageSchema.parse(page);
  const row = { company_id: id, headline: p.headline, blurb: p.blurb, show_goal: p.showGoal, metric_keys: [...p.metricKeys], show_site_link: p.showSiteLink, listed: p.listed };
  const { data, error } = await db.from("public_pages").upsert(row, { onConflict: "company_id" }).select(PAGE_COLUMNS).single();
  if (error || !data) throw dbError("Could not save public page", error);
  return toPage(data);
}

/** The owner's client: the switch (`companies.public_page_enabled`), off by default. */
export async function setPublicPageEnabled(db: DbClient, companyId: string, enabled: boolean): Promise<void> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("companies").update({ public_page_enabled: z.boolean().parse(enabled) }).eq("id", id).select("id").maybeSingle();
  if (error) throw dbError("Could not switch the public page", error);
  if (!data) throw new DbError(`Company ${id} not found or not yours to change`);
}

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

const ViewInputSchema = z.object({
  name: z.string(),
  page: z.object({ headline: z.string(), blurb: z.string(), showGoal: z.boolean(), metricKeys: z.array(z.string()), showSiteLink: z.boolean(), listed: z.boolean() }),
  goal: z.object({ metricKey: z.string(), target: z.coerce.number(), current: z.coerce.number() }).nullable(),
  metrics: z.array(z.object({ key: z.string(), value: z.coerce.number() })),
  siteUrl: z.string().nullable(),
});

/**
 * The anonymous read (`/p/[slug]`, the anon client): the chosen fields through
 * core's pure `publicPageView` (strings through `sanitizeText`, https site
 * links only, at most three metrics), validated; null → 404.
 */
export async function publicPageView(db: DbClient, slug: string): Promise<PublicPageView | null> {
  const s = SlugSchema.safeParse(slug);
  if (!s.success) return null;
  const { data, error } = await db.rpc("public_page_view", { p_slug: s.data });
  if (error) throw dbError("Could not load public page view", error);
  if (data === null) return null;
  const view = PublicPageViewSchema.parse(composePublicPageView(ViewInputSchema.parse(data)));
  return Object.freeze({ ...view, metrics: Object.freeze(view.metrics.map((m) => Object.freeze(m))) }) as PublicPageView;
}
