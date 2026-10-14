import { mkdir, rm, writeFile } from "node:fs/promises";
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

/** Replaces the directory's content with the given files (atomic enough for a sandbox). */
export async function writeTree(dir: string, files: readonly RepoFile[]): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    const target = safeJoin(dir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
}
