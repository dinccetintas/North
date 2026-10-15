import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicPageView } from "@north/db";
import type { PublicPageView } from "@north/core/public-page";
import { createAnonClient } from "@/lib/supabase/anon";
import { PublicPage } from "@/components/public-page";

/**
 * PUB-1: a company's public page, outside the signed-in app. Read with the
 * anonymous client through `public_page_view` only (null → 404), cached for
 * 60 s and revalidated when the owner saves; `noindex` until "listed".
 */
export const revalidate = 60;

/** Every slug is rendered on its first visit and then cached (ISR); none at build time. */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

type Params = Promise<{ slug: string }>;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

const viewFor = cache(async (slug: string): Promise<PublicPageView | null> => (SLUG_RE.test(slug) ? publicPageView(createAnonClient(), slug) : null));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const view = await viewFor(slug);
  if (!view) return { title: "Not found", robots: { index: false, follow: false } };
  return {
    title: { absolute: view.name },
    description: view.headline,
    robots: view.listed ? { index: true, follow: false } : { index: false, follow: false },
  };
}

export default async function PublicCompanyPage({ params }: { params: Params }) {
  const { slug } = await params;
  const view = await viewFor(slug);
  if (!view) notFound();
  return <PublicPage view={view} />;
}
