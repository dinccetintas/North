import { exportPath, PPTX_KINDS, type ExportFormat } from "@north/core";
import { getArtifactMarkdown, listArtifacts, type ArtifactRecord } from "@north/db";
import type { WorkerDeps } from "../../deps";
import { writeEntry, type ManifestFile } from "./files";
import { renderPdf } from "./render-pdf";
import { renderPptx } from "./render-pptx";

/**
 * MEM-2 (D6-4): `artifacts/<company-slug>/<kind>/<title>-v<n>.<md|pdf|pptx>`
 * for every version of every artifact of the planned companies. The `.md` is
 * the stored markdown byte for byte; a PDF (every kind) and a PPTX (decks and
 * plans) are rendered next to it. A renderer that refuses (above 5 MB) or
 * fails leaves its file out and the README lists it; the markdown is never
 * left out.
 */

export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
}

export interface ArtifactFiles {
  readonly files: readonly ManifestFile[];
  readonly skipped: readonly SkippedFile[];
}

const oldestFirst = (a: ArtifactRecord, b: ArtifactRecord): number => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title) || a.version - b.version;

/** Two titles that slug alike ("PRD!" and "PRD?") get "-2", "-3": an entry path is never written twice. */
function uniquePaths(slug: string, artifact: ArtifactRecord, used: Set<string>): (format: ExportFormat) => string {
  let title = artifact.title;
  for (let n = 2; used.has(exportPath(slug, artifact.kind, title, artifact.version, "md")); n += 1) title = `${artifact.title} ${n}`;
  used.add(exportPath(slug, artifact.kind, title, artifact.version, "md"));
  return (format) => exportPath(slug, artifact.kind, title, artifact.version, format);
}

type Render = (markdown: string, opts: { readonly title: string }) => Promise<Uint8Array>;

async function rendered(dir: string, path: string, kind: "pdf" | "pptx", render: Render, markdown: string, title: string): Promise<ManifestFile | SkippedFile> {
  try {
    return await writeEntry(dir, path, await render(markdown, { title }), kind);
  } catch (error) {
    return Object.freeze({ path, reason: error instanceof Error ? error.message.slice(0, 200) : "could not render" });
  }
}

const isSkipped = (f: ManifestFile | SkippedFile): f is SkippedFile => "reason" in f;

/** One company's artifact files, written under `dir`. */
export async function companyArtifactFiles(deps: Pick<WorkerDeps, "db">, dir: string, company: { readonly id: string; readonly slug: string }): Promise<ArtifactFiles> {
  const files: ManifestFile[] = [];
  const skipped: SkippedFile[] = [];
  const used = new Set<string>();
  for (const artifact of [...(await listArtifacts(deps.db, company.id))].sort(oldestFirst)) {
    const markdown = await getArtifactMarkdown(deps.db, artifact.id);
    if (markdown === null) continue;
    const pathFor = uniquePaths(company.slug, artifact, used);
    files.push(await writeEntry(dir, pathFor("md"), markdown, "md"));
    const extra = [await rendered(dir, pathFor("pdf"), "pdf", renderPdf, markdown, artifact.title)];
    if (PPTX_KINDS.includes(artifact.kind)) extra.push(await rendered(dir, pathFor("pptx"), "pptx", renderPptx, markdown, artifact.title));
    for (const f of extra) {
      if (isSkipped(f)) skipped.push(f);
      else files.push(f);
    }
  }
  return Object.freeze({ files: Object.freeze(files), skipped: Object.freeze(skipped) });
}
