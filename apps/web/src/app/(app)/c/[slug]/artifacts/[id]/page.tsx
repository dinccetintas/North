import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getArtifact, getArtifactMarkdown } from "@north/db";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { roleTitle } from "@/lib/labels";
import { Markdown } from "@/components/markdown";

type Params = Promise<{ slug: string; id: string }>;

const IdSchema = z.string().uuid();

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return { title: "Artifact" };
  const db = await createClient();
  const artifact = await getArtifact(db, id);
  return { title: artifact?.title ?? "Artifact" };
}

export default async function ArtifactPage({ params }: { params: Params }) {
  const { slug, id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const artifact = await getArtifact(db, id);
  if (!artifact || artifact.companyId !== company.id) notFound();
  const markdown = await getArtifactMarkdown(db, id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href={`/c/${slug}/artifacts`} className="mono-label text-faint hover:text-fg hover:underline">
        ← Artifacts
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mono-label text-faint">
            {artifact.kind.replace(/_/g, " ")} · v{artifact.version} · {roleTitle(artifact.createdByRole)} ·{" "}
            {new Date(artifact.createdAt).toLocaleDateString("en-GB")}
          </p>
          <h1 className="mt-1 text-4xl" data-testid="artifact-title">
            {artifact.title}
          </h1>
        </div>
        <a href={`/api/artifacts/${artifact.id}`} download className="retro-button" data-testid="artifact-download">
          Download .md
        </a>
      </div>

      <article className="mt-8 border-t border-surface-border pt-8">
        {markdown === null ? (
          <p className="border border-surface-border bg-surface p-5 text-muted">The file for this artifact is missing from storage.</p>
        ) : (
          <Markdown source={markdown} />
        )}
      </article>
    </main>
  );
}
