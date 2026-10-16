import { exportPath, PPTX_KINDS, type ExportFormat } from "@north/core";
import { ArtifactPathError, getArtifactMarkdown, listArtifacts, type ArtifactRecord } from "@north/db";
import type { WorkerDeps } from "../../deps";
import { spentReason, type ExportBudget, type Meter } from "./budget";
import { writeEntry, type ManifestFile } from "./files";
import { renderPdf } from "./render-pdf";
import { renderPptx } from "./render-pptx";

/**
 * MEM-2 (D6-4): `artifacts/<company-slug>/<kind>/<title>-v<n>.<md|pdf|pptx>`
 * for every version of every artifact of the planned companies (read in
 * pages, M6 review M5). The `.md` is the stored markdown byte for byte; a PDF
 * (every kind) and a PPTX (decks and plans) are rendered next to it. A
 * renderer that refuses (above 5 MB) or fails leaves its file out and the
 * README lists it. M6 review M4: every file counts against the export's
 * budget; once it is spent the rest is left out and listed. M2: a row whose
 * storage path is not its company's is refused, never downloaded.
 */

export interface SkippedFile {
  readonly path: string;
  /** The README's words after the path: "was not rendered: …", "was not exported: …", "was left out: …". */
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

interface Budgeted {
  readonly dir: string;
  readonly budget: ExportBudget;
  readonly meter: Meter;
}

/** Writes the content when it fits what is left of the budget, else names it as left out. */
async function within(b: Budgeted, path: string, content: string | Uint8Array, kind: ManifestFile["kind"]): Promise<ManifestFile | SkippedFile> {
  const size = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
  if (size > b.meter.remaining()) return Object.freeze({ path, reason: `was ${spentReason(b.budget)}` });
  const file = await writeEntry(b.dir, path, content, kind);
  b.meter.spend(file.bytes);
  return file;
}

async function rendered(b: Budgeted, path: string, kind: "pdf" | "pptx", render: Render, markdown: string, title: string): Promise<ManifestFile | SkippedFile> {
  if (b.meter.remaining() === 0) return Object.freeze({ path, reason: `was ${spentReason(b.budget)}` });
  let bytes: Uint8Array;
  try {
    bytes = await render(markdown, { title });
  } catch (error) {
    return Object.freeze({ path, reason: `was not rendered: ${error instanceof Error ? error.message.slice(0, 200) : "could not render"}` });
  }
  return within(b, path, bytes, kind);
}

const isSkipped = (f: ManifestFile | SkippedFile): f is SkippedFile => "reason" in f;

/** The stored markdown, or the README line saying why it is not in the export (M2: a path outside the company's folder). */
async function markdownOf(artifact: ArtifactRecord, db: WorkerDeps["db"], path: string): Promise<string | SkippedFile | null> {
  try {
    return await getArtifactMarkdown(db, artifact.id);
  } catch (error) {
    if (error instanceof ArtifactPathError) return Object.freeze({ path, reason: "was not exported: its storage path is not in this company's folder" });
    throw error;
  }
}

/** One company's artifact files, written under `dir` within what is left of the export's budget. */
export async function companyArtifactFiles(deps: Pick<WorkerDeps, "db">, dir: string, company: { readonly id: string; readonly slug: string }, budget: ExportBudget, meter: Meter): Promise<ArtifactFiles> {
  const b: Budgeted = { dir, budget, meter };
  const files: ManifestFile[] = [];
  const skipped: SkippedFile[] = [];
  const used = new Set<string>();
  for (const artifact of [...(await listArtifacts(deps.db, company.id))].sort(oldestFirst)) {
    const pathFor = uniquePaths(company.slug, artifact, used);
    const markdown = meter.remaining() === 0 ? Object.freeze({ path: pathFor("md"), reason: `was ${spentReason(budget)}` }) : await markdownOf(artifact, deps.db, pathFor("md"));
    if (markdown === null) continue;
    if (typeof markdown !== "string") {
      skipped.push(markdown);
      continue;
    }
    const md = await within(b, pathFor("md"), markdown, "md");
    if (isSkipped(md)) {
      skipped.push(md);
      continue;
    }
    files.push(md);
    const extra = [await rendered(b, pathFor("pdf"), "pdf", renderPdf, markdown, artifact.title)];
    if (PPTX_KINDS.includes(artifact.kind)) extra.push(await rendered(b, pathFor("pptx"), "pptx", renderPptx, markdown, artifact.title));
    for (const f of extra) {
      if (isSkipped(f)) skipped.push(f);
      else files.push(f);
    }
  }
  return Object.freeze({ files: Object.freeze(files), skipped: Object.freeze(skipped) });
}
