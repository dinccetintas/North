import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { WorkspacePathSchema } from "@north/core";
import { z } from "zod";
import type { WorkerDeps } from "../../deps";

/**
 * The export's scratch space: `WORKSPACE_ROOT/exports/<exportId>/files/<path>`
 * for the entries and `…/<exportId>/export.zip` for the archive. Removed after
 * the upload and on failure; nothing in it outlives the job.
 */

export type ExportFileKind = "md" | "pdf" | "pptx" | "json" | "csv" | "readme";

export interface ManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly kind: ExportFileKind;
}

export const exportDir = (deps: Pick<WorkerDeps, "env">, exportId: string): string => resolve(deps.env.WORKSPACE_ROOT, "exports", z.uuid().parse(exportId));

export const filesDir = (dir: string): string => join(dir, "files");

/** The absolute path of one entry; the entry path is a `WorkspacePathSchema` path and must stay inside the directory. */
export function entryPath(dir: string, path: string): string {
  const root = resolve(filesDir(dir));
  const target = resolve(root, WorkspacePathSchema.parse(path));
  if (!target.startsWith(`${root}${sep}`)) throw new Error(`export: ${path} leaves the export directory`);
  return target;
}

/** Writes one entry and returns its manifest line. */
export async function writeEntry(dir: string, path: string, content: string | Uint8Array, kind: ExportFileKind): Promise<ManifestFile> {
  const target = entryPath(dir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return Object.freeze({ path, bytes: typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength, kind });
}

/** An entry written piece by piece (M6 review M4: rows go to disk as they are read, never held whole). */
export interface EntrySink {
  readonly path: string;
  /** Bytes written so far. */
  bytes(): number;
  write(text: string): Promise<void>;
  /** Flushes and closes the file; resolves with its manifest line. */
  close(): Promise<ManifestFile>;
}

export async function openEntry(dir: string, path: string, kind: ExportFileKind): Promise<EntrySink> {
  const target = entryPath(dir, path);
  await mkdir(dirname(target), { recursive: true });
  const stream = createWriteStream(target);
  let written = 0;
  return {
    path,
    bytes: () => written,
    write: (text) =>
      new Promise<void>((resolve, reject) => {
        written += Buffer.byteLength(text, "utf8");
        stream.write(text, "utf8", (error) => (error ? reject(error) : resolve()));
      }),
    close: () =>
      new Promise<ManifestFile>((resolve, reject) => {
        stream.once("error", reject);
        stream.end(() => resolve(Object.freeze({ path, bytes: written, kind })));
      }),
  };
}

/** True when every entry is still on this machine's disk (a later step may run elsewhere). */
export async function allPresent(dir: string, files: readonly ManifestFile[]): Promise<boolean> {
  for (const f of files) {
    const s = await stat(entryPath(dir, f.path)).catch(() => null);
    if (!s || s.size !== f.bytes) return false;
  }
  return true;
}

export const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true });
