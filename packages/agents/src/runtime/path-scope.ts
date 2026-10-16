// SEC-1: pure helpers that keep an agent's file tools inside its task workspace.
// The built-in file tools run in the Claude process, outside the OS sandbox, and
// accept any host path, so the PreToolUse hook (`auditHook`) asks this module
// whether every path a call names stays inside `<workspaceRoot>/<taskId>`. A
// path is judged by where it really lands (symlinks followed, also through
// parts that do not exist yet), never by its spelling alone. Everything here
// is read-only and fails closed: when in doubt, or on an error, the answer is no.
import { lstat, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";

/** Built-in tools that take a path argument. Everything else is either pathless or sandboxed (Bash). */
export const PATH_SCOPED_TOOLS: readonly string[] = Object.freeze(["Read", "Glob", "Grep", "Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** A value that is safe as exactly one path segment (a uuid or a short slug): never a separator, a dot or a NUL. */
export const PathSegmentSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Input keys that hold a path, across the tools above. */
const PATH_KEYS: readonly string[] = ["file_path", "path", "notebook_path"];

/** A path segment holding any of these is a glob, not a literal name. */
const GLOB_CHARS = /[*?[\]{}()!]/;

/** Symbolic links followed while resolving one path before it counts as a loop. */
const MAX_LINKS = 40;

/** The string value of `input[key]`: `[]` when absent, `[value]` when a string; anything else is refused. */
function stringArgument(toolName: string, input: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = input[key];
  if (value === undefined) return [];
  if (typeof value !== "string") throw new Error(`${toolName} input "${key}" is not a string`);
  return [value];
}

/** The literal leading part of a glob pattern: its segments up to the first one holding a glob character. */
function staticPrefixOf(pattern: string): string {
  const segments = pattern.split("/");
  const firstGlob = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  const joined = (firstGlob === -1 ? segments : segments.slice(0, firstGlob)).join("/");
  return joined === "" && pattern.startsWith("/") ? "/" : joined;
}

/**
 * Glob searches from its own base when the pattern is absolute, so the fixed
 * part of the pattern is a path too. A relative pattern's fixed part is joined
 * under the `path` argument (the search root) when there is one.
 */
function globPatternPaths(pattern: string, searchRoot: string | undefined): readonly string[] {
  const prefix = staticPrefixOf(pattern);
  if (prefix === "") return [];
  if (prefix.startsWith("/") || prefix.startsWith("~") || searchRoot === undefined) return [prefix];
  return [`${searchRoot}/${prefix}`];
}

/**
 * The paths a tool call asks to touch, as written in its input: `file_path`,
 * `path` and `notebook_path` when present, plus the fixed part of a Glob
 * pattern. A Glob or Grep without `path` searches the cwd and yields nothing.
 * A tool outside `PATH_SCOPED_TOOLS` yields nothing. Throws when the input is
 * not an object or a path argument is not a string (the hook turns a throw
 * into a denial).
 */
export function pathArgumentsOf(toolName: string, toolInput: unknown): readonly string[] {
  if (!PATH_SCOPED_TOOLS.includes(toolName)) return [];
  if (typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput)) throw new Error(`${toolName} input is not an object`);
  const input = toolInput as Readonly<Record<string, unknown>>;
  const paths = PATH_KEYS.flatMap((key) => stringArgument(toolName, input, key));
  if (toolName !== "Glob") return paths;
  const [pattern] = stringArgument(toolName, input, "pattern");
  return pattern === undefined ? paths : [...paths, ...globPatternPaths(pattern, stringArgument(toolName, input, "path")[0])];
}

/** True when `target` is `root` or below it. Uses `relative`, so a root of "/" and sibling names that share a prefix both work. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A relative path that starts by climbing out of its base (`../x`, even `../base/x`): never needed inside a workspace. */
const climbsOut = (path: string): boolean => !isAbsolute(path) && normalize(path).split(sep)[0] === "..";

const isMissing = (error: unknown): boolean => error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");

/** Where a dangling symbolic link at `path` points, or null when `path` is not a symbolic link. */
async function danglingTarget(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return resolve(dirname(path), await readlink(path));
}

/**
 * The real path `absolute` would end up at: the deepest existing ancestor is
 * resolved through `realpath` and the rest re-appended. A dangling symbolic
 * link is followed to its target, because a write through it creates that
 * target. Throws on a loop or any error other than "does not exist".
 */
async function realResolve(absolute: string, links = 0): Promise<string> {
  if (links > MAX_LINKS) throw new Error(`too many symbolic links while resolving ${absolute}`);
  const rest: string[] = [];
  let existing = absolute;
  for (;;) {
    try {
      return resolve(await realpath(existing), ...rest);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const target = await danglingTarget(existing);
    if (target !== null) return realResolve(resolve(target, ...rest), links + 1);
    const parent = dirname(existing);
    if (parent === existing) throw new Error(`no existing ancestor for ${absolute}`);
    rest.unshift(basename(existing));
    existing = parent;
  }
}

/** One candidate against the workspace, lexically (under either spelling of the workspace) and by real path. */
async function isInsideWorkspace(root: string, realRoot: string, candidate: string, cwd: string): Promise<boolean> {
  // the tools trim a path and expand a leading ~ to the home dir before they resolve it
  const path = candidate.trim();
  if (candidate.includes("\0") || path.startsWith("~") || climbsOut(path)) return false;
  const absolute = resolve(cwd, path);
  if (!isInside(root, absolute) && !isInside(realRoot, absolute)) return false;
  return isInside(realRoot, await realResolve(absolute));
}

/**
 * The first of `candidates` that is not inside `workspace`, or null when all
 * are. A candidate is inside when it resolves (against `cwd`, default the
 * workspace) to the workspace or below, and so does its real path. `..`
 * climbs, absolute paths elsewhere, `~` prefixes, NUL bytes and symbolic
 * links (also dangling ones) that lead out are all outside. Throws when the
 * filesystem cannot answer (a symlink loop, no permission): treat that as a no.
 */
export async function pathOutsideWorkspace(workspace: string, candidates: readonly string[], cwd: string = workspace): Promise<string | null> {
  const root = resolve(workspace);
  const realRoot = await realResolve(root);
  for (const candidate of candidates) {
    if (!(await isInsideWorkspace(root, realRoot, candidate, cwd))) return candidate;
  }
  return null;
}
