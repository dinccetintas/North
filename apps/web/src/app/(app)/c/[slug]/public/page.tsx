import { notFound } from "next/navigation";
import { getPublicPage, publicPageView } from "@north/db";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { PublicPageForm } from "@/components/public-page-form";

export const metadata = { title: "Public page" };

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ saved?: string; error?: string }>;

/**
 * PUB-1: the owner's editor. Whether the page is public is read the way a
 * stranger reads it (the anonymous view), so the switch never claims more
 * than the world sees.
 */
export default async function PublicPageEditor({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, { saved, error }] = await Promise.all([params, searchParams]);
  const company = await companyBySlug(slug);
  if (!company) notFound();
  const [page, view] = await Promise.all([getPublicPage(await createClient(), company.id), publicPageView(createAnonClient(), slug)]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="mono-label text-faint">Off by default · text only · no link into North</p>
      <h1 className="mt-1 text-4xl">Public page</h1>
      <p className="mt-3 text-muted">A page about {company.name} for anyone with the link: only what you choose here, never the thesis, the plan or the ledger.</p>

      {saved ? (
        <p className="mono-label mt-6 border border-success bg-success-bg px-3 py-3 text-success" data-testid="public-saved">
          Saved.
        </p>
      ) : null}
      {error ? (
        <p className="mono-label mt-6 border border-error bg-error-bg px-3 py-3 text-error" role="alert">
          {error}
        </p>
      ) : null}

      <PublicPageForm slug={slug} enabled={view !== null} page={page} />

      <p className="mono-label mt-4 flex flex-wrap items-center gap-3 text-faint">
        <span data-testid="public-state" data-public={view ? "true" : "false"}>
          {view ? "Public now." : "Not public."}
        </span>
        <a href={`/p/${slug}`} target="_blank" rel="noreferrer noopener" className="underline" data-testid="public-preview">
          Open /p/{slug}
        </a>
      </p>
    </main>
  );
}
