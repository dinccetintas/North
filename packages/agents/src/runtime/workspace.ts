import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { MAX_OUTPUT_FILES, MAX_OUTPUT_FILE_BYTES, MAX_OUTPUT_TOTAL_BYTES, OutputFilesSchema, type OutputFile } from "@north/core";

/** Folders a workspace scan never enters; build output and dependencies are the agent's business, not the repo's. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", ".next", "dist", "out", ".turbo", ".cache", "coverage"]);

/** Binary and lock files are skipped: the site is text (HTML, CSS, Markdown, JS, JSON, SVG). */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".html", ".htm", ".css", ".md", ".txt", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".svg", ".xml", ".yml", ".yaml", ".toml", ".env.example"]);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

/**
 * Collects the files an engineering run left in its workspace, as the same
 * `OutputFile[]` shape the mock fixture returns, so live and mock runs feed
 * one build pipeline. Hidden entries, ignored folders, binaries and oversized
 * files are skipped; the result is validated against the core limits.
 */
export async function workspaceFiles(dir: string): Promise<readonly OutputFile[]> {
  const files: OutputFile[] = [];
  let total = 0;
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(extensionOf(entry.name))) continue;
      const info = await stat(full);
      if (info.size > MAX_OUTPUT_FILE_BYTES || total + info.size > MAX_OUTPUT_TOTAL_BYTES || files.length >= MAX_OUTPUT_FILES) continue;
      const content = await readFile(full, "utf8");
      total += info.size;
      files.push({ path: relative(dir, full).split(sep).join("/"), content });
    }
  };
  await walk(dir);
  return Object.freeze(OutputFilesSchema.parse(files));
}
