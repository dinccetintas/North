import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ZipArchive } from "archiver";
import { EXPORT_TTL_DAYS } from "@north/core";
import { EXPORTS_BUCKET, exportStoragePath, setExportReady } from "@north/db";
import type { WorkerDeps } from "../../deps";
import type { StepRunner } from "../steps";
import { companyArtifactFiles, type SkippedFile } from "./artifact-files";
import { EXPORT_BUDGET, meter, type Cut, type ExportBudget } from "./budget";
import { companyDataFiles, profileDataFile } from "./data-export";
import { allPresent, entryPath, exportDir, removeDir, writeEntry, type ManifestFile } from "./files";
import { loadExport, type ExportOutcome, type ExportPlan } from "./load";
import { exportReadme, README_PATH } from "./readme";

export { EXPORT_FAILURES, failExport, type ExportOutcome } from "./load";

/**
 * `build-export` (EXP-1, MEM-2, ADR 0016): `load` → `artifacts` → `data` →
 * `bundle`. The entries are written under `WORKSPACE_ROOT/exports/<id>/`
 * (data rows page by page), streamed into one zip (`archiver`), uploaded
 * from the file as a stream with the service role to the private `exports`
 * bucket at `users/<userId>/exports/<id>.zip`, recorded (`ready`, bytes,
 * manifest, `expires_at` +7 d on the worker clock) and the directory
 * removed. M6 review M4: every entry counts against the `ExportBudget`
 * (artifacts first, then data), and the README names what was cut. K0: it
 * reads the owner's own data and nothing leaves North, so it passes no gate
 * and carries no action kind.
 */

type Deps = Pick<WorkerDeps, "db" | "env" | "clock">;

interface ArtifactsStep {
  readonly files: readonly ManifestFile[];
  readonly skipped: readonly SkippedFile[];
}

interface DataStep {
  readonly files: readonly ManifestFile[];
  readonly cuts: readonly Cut[];
}

const DAY_MS = 86_400_000;
const ZIP_CONTENT_TYPE = "application/zip";

const bytesOf = (files: readonly ManifestFile[]): number => files.reduce((sum, f) => sum + f.bytes, 0);

/** The `artifacts` step: every artifact version of every planned company (none for a data export), within the budget. */
export async function produceArtifacts(deps: Deps, plan: ExportPlan, budget: ExportBudget = EXPORT_BUDGET): Promise<ArtifactsStep> {
  if (plan.kind === "data") return { files: [], skipped: [] };
  const dir = exportDir(deps, plan.exportId);
  const m = meter(budget);
  const parts = [];
  for (const company of plan.companies) parts.push(await companyArtifactFiles(deps, dir, company, budget, m));
  return { files: parts.flatMap((p) => p.files), skipped: parts.flatMap((p) => p.skipped) };
}

/** The `data` step: each company's tables and the owner's profile (none for an artifacts export), within what the artifacts left of the budget. */
export async function produceData(deps: Deps, plan: ExportPlan, budget: ExportBudget = EXPORT_BUDGET, used = 0): Promise<DataStep> {
  if (plan.kind === "artifacts") return { files: [], cuts: [] };
  const dir = exportDir(deps, plan.exportId);
  const m = meter(budget, used);
  const parts = [];
  for (const company of plan.companies) parts.push(await companyDataFiles(deps, dir, company, budget, m));
  parts.push(await profileDataFile(deps, dir, plan.userId, budget, m));
  return { files: parts.flatMap((p) => p.files), cuts: parts.flatMap((p) => p.cuts) };
}

/** Streams the entries into `<dir>/export.zip`; resolves with its size once the file is closed. */
export async function zipEntries(dir: string, files: readonly ManifestFile[]): Promise<{ readonly path: string; readonly bytes: number }> {
  const path = join(dir, "export.zip");
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const out = createWriteStream(path);
  const closed = new Promise<void>((resolve, reject) => {
    out.on("close", resolve);
    out.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", reject);
  });
  archive.pipe(out);
  for (const f of files) archive.file(entryPath(dir, f.path), { name: f.path });
  await archive.finalize();
  await closed;
  return { path, bytes: (await stat(path)).size };
}

/** The `bundle` step: README, zip, upload, `ready`; the directory is removed whatever happens (a retry rebuilds it). */
export async function bundleExport(deps: Deps, plan: ExportPlan, artifacts: ArtifactsStep, data: DataStep, budget: ExportBudget = EXPORT_BUDGET): Promise<ExportOutcome> {
  const dir = exportDir(deps, plan.exportId);
  try {
    // A later step may run on another machine or after a restart: rebuild what is not on this disk.
    const present = await allPresent(dir, [...artifacts.files, ...data.files]);
    const a = present ? artifacts : await produceArtifacts(deps, plan, budget);
    const d = present ? data : await produceData(deps, plan, budget, bytesOf(a.files));
    const generatedAt = deps.clock().toISOString();
    const entries = [...a.files, ...d.files];
    const readme = await writeEntry(dir, README_PATH, exportReadme({ kind: plan.kind, generatedAt, companies: plan.companies, files: entries, skipped: a.skipped, cuts: d.cuts }), "readme");
    const files = [readme, ...entries];
    const zip = await zipEntries(dir, files);
    const storagePath = exportStoragePath(plan.userId, plan.exportId);
    const body = createReadStream(zip.path);
    const upload = await deps.db.storage
      .from(EXPORTS_BUCKET)
      .upload(storagePath, body, { contentType: ZIP_CONTENT_TYPE, upsert: true })
      .finally(() => body.destroy());
    if (upload.error) throw new Error(`export upload failed: ${upload.error.message}`);
    const expiresAt = new Date(deps.clock().getTime() + EXPORT_TTL_DAYS * DAY_MS).toISOString();
    const manifest = { files, companies: plan.companies.map((c) => ({ slug: c.slug, repoUrl: c.repoUrl })), generatedAt };
    const record = await setExportReady(deps.db, plan.exportId, { storagePath, bytes: zip.bytes, manifest, expiresAt });
    return { status: "ready", exportId: plan.exportId, bytes: zip.bytes, files: files.length, expiresAt: record.expiresAt };
  } finally {
    await removeDir(dir);
  }
}

/**
 * The job: the event names the export and the user; the row decides the
 * owner, the scope and whether it may run. Any thrown error is retried by
 * Inngest and, after the last retry, `failExport` marks the row.
 */
export async function buildExport(deps: Deps, step: StepRunner, exportId: string, userId: string, budget: ExportBudget = EXPORT_BUDGET): Promise<ExportOutcome> {
  const loaded = await step.run("load", () => loadExport(deps, exportId, userId));
  if (!loaded.ok) return loaded.outcome;
  const { plan } = loaded;
  const artifacts = await step.run("artifacts", () => produceArtifacts(deps, plan, budget));
  const data = await step.run("data", () => produceData(deps, plan, budget, bytesOf(artifacts.files)));
  return step.run("bundle", () => bundleExport(deps, plan, artifacts, data, budget));
}
