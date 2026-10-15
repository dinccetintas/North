import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { RepoFile } from "../types";

/** Where sandbox repos and sites live on disk; `SANDBOX_ROOT` or a temp folder. */
export function defaultSandboxRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.SANDBOX_ROOT ?? join(tmpdir(), "north-sandbox");
}

/** Rejects paths that would escape `dir`; returns the absolute target path. */
export function safeJoin(dir: string, relative: string): string {
  const base = resolve(dir);
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(base + sep)) throw new Error(`Refusing to write outside the sandbox: ${relative}`);
  return target;
}

/** Removes everything at the top of `dir` except the entries named in `keep`. */
async function clearExcept(dir: string, keep: readonly string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  for (const entry of entries) if (!keep.includes(entry)) await rm(join(dir, entry), { recursive: true, force: true });
}

/**
 * Replaces the directory's content with the given files (atomic enough for a
 * sandbox). `keep` names top-level entries that survive the rewrite: the
 * sandbox repo keeps its branches and pull requests across main pushes.
 */
export async function writeTree(dir: string, files: readonly RepoFile[], keep: readonly string[] = []): Promise<void> {
  if (keep.length === 0) await rm(dir, { recursive: true, force: true });
  else await clearExcept(dir, keep);
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    const target = safeJoin(dir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
}
