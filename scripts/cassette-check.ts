/**
 * TST-2: the cassette check (`pnpm cassette:check`, a `pnpm validate` step and a
 * CI step). Cassettes are committed (`cassettes/README.md`), so before they
 * are, and on every run after, each `cassettes/*.json` must be what the model
 * gateway wrote and nothing else. The rules for one file are in
 * `cassette-rules.ts` (a strict cassette, its name is its key, no secret in a
 * body, header, path or metadata string, no credential header or encoded reply,
 * the pinned Agent SDK version, a key that recomputes); this script applies
 * them to a directory, and fails on anything in it but `*.json` and `README.md`
 * (a leftover temp file or a subfolder holds data the rules never read) and on a
 * directory it cannot read. Usage:
 *
 *   [NORTH_CASSETTE_DIR=<dir>] pnpm cassette:check
 *
 * `NORTH_CASSETTE_DIR` defaults to `cassettes` (a relative path is read from the
 * repo root). Prints `cassette check: N files, W warnings` (plus `, F failed`),
 * each failure and warning as `FAIL|WARN <file>: <reason>` on stderr, and exits
 * 1 on any failure. A finding names the kind of secret and where, never the
 * secret. The script reads and reports; it never changes a cassette.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { sdkVersionOf } from "../apps/worker/src/gateway/cassette";
import { verdictFor, type Verdict } from "./cassette-rules";

/** The rules live in cassette-rules.ts and the gateway; re-exported so this is the one door for tests and callers. */
export { secretFindings, verdictFor } from "./cassette-rules";
export type { CassetteInput, Verdict } from "./cassette-rules";
/** The gateway's reading of the user agent and this check's are one function. */
export { sdkVersionOf };

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_SDK = "@anthropic-ai/claude-agent-sdk";

// ---- the directory ------------------------------------------------------------

/** What a run found: the cassettes read, the warnings, the failing files (and stray entries), and the lines to print. */
export interface Report {
  readonly files: number;
  readonly warnings: number;
  readonly failures: number;
  readonly lines: readonly string[];
}

/** The only entries that may sit next to the cassettes. */
const ALLOWED_OTHER: ReadonlySet<string> = new Set(["README.md", ".gitkeep"]);

const report = (files: number, warnings: number, failures: number, lines: readonly string[]): Report => Object.freeze({ files, warnings, failures, lines: Object.freeze([...lines]) });

/** `cassette check: 3 files, 1 warnings`, plus `, 2 failed` when any file failed. */
export const summaryLine = (r: Report): string => `cassette check: ${r.files} files, ${r.warnings} warnings${r.failures > 0 ? `, ${r.failures} failed` : ""}`;

/** The `FAIL`/`WARN` lines of one verdict. */
const linesOf = (v: Verdict): string[] => [...v.failures.map((reason) => `FAIL ${v.name}: ${reason}`), ...v.warnings.map((reason) => `WARN ${v.name}: ${reason}`)];

/**
 * Checks every `*.json` in `dir` against the Agent SDK `pin`. Anything else in
 * the directory but `README.md` fails (a leftover temp file or a subfolder
 * holds data the checks never read), and so does a directory that cannot be
 * read: a mistyped path is not an empty set.
 */
export async function checkDirectory(dir: string, pin: string): Promise<Report> {
  let entries;
  try {
    entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (error) {
    return report(0, 0, 1, [`FAIL ${dir}: cannot read the cassette directory (${(error as NodeJS.ErrnoException).code ?? "error"})`]);
  }
  const stray = entries.filter((e) => !(e.isFile() && e.name.endsWith(".json")) && !ALLOWED_OTHER.has(e.name));
  const cassettes = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
  const verdicts = await Promise.all(cassettes.map(async (e) => verdictFor({ name: e.name, text: await readFile(join(dir, e.name), "utf8") }, pin)));
  const lines = [
    ...stray.map((e) => `FAIL ${e.name}: unexpected ${e.isDirectory() ? "directory" : "file"} in the cassette directory (only <key>.json files and README.md belong here)`),
    ...verdicts.flatMap(linesOf),
  ];
  return report(verdicts.length, verdicts.reduce((n, v) => n + v.warnings.length, 0), stray.length + verdicts.filter((v) => v.failures.length > 0).length, lines);
}

// ---- the pin and the command --------------------------------------------------

const AgentsPackageSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional(), devDependencies: z.record(z.string(), z.string()).optional() });

/** The Agent SDK version `packages/agents/package.json` pins (the string as written: an exact version). */
export async function readPin(packageJsonPath: string): Promise<string> {
  const parsed = AgentsPackageSchema.safeParse(JSON.parse(await readFile(packageJsonPath, "utf8")));
  const pin = parsed.success ? (parsed.data.dependencies?.[AGENT_SDK] ?? parsed.data.devDependencies?.[AGENT_SDK]) : undefined;
  if (pin === undefined) throw new Error(`${packageJsonPath} does not pin ${AGENT_SDK}: the cassette check compares recordings to that pin`);
  return pin;
}

async function main(): Promise<number> {
  const dir = resolve(REPO_ROOT, process.env.NORTH_CASSETTE_DIR?.trim() || "cassettes");
  const result = await checkDirectory(dir, await readPin(resolve(REPO_ROOT, "packages/agents/package.json")));
  for (const line of result.lines) console.error(line);
  console.log(summaryLine(result));
  return result.failures > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`cassette check: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
