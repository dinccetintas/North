import { z } from "zod";
import { getArtifact, getArtifactMarkdown, slugify } from "@north/db";
import { createClient } from "@/lib/supabase/server";

const IdSchema = z.string().uuid();

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });

/**
 * Streams an artifact's markdown as a download. Ownership is enforced by RLS:
 * the server client only sees artifacts of companies the signed-in user owns.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();

  const db = await createClient();
  const artifact = await getArtifact(db, id);
  if (!artifact) return notFound();
  const markdown = await getArtifactMarkdown(db, id);
  if (markdown === null) return notFound();

  const filename = `${slugify(artifact.title) || artifact.kind}-v${artifact.version}.md`;
  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
