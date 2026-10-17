/**
 * TST-2: the cassette check (`pnpm cassette:check`, a `pnpm validate` step and a
 * CI step). Cassettes are committed (`cassettes/README.md`), so before they
 * are, and on every run after, each `cassettes/*.json` must be what the model
 * gateway wrote and nothing else:
 *
 *   it is a valid cassette (the gateway's own Zod schema, `CassetteFileSchema`)
 *   its file name is its key (a renamed or copied cassette fails)
 *   no body, header or path holds an Anthropic key, a bearer token or a
 *     `@north.test` address other than `redacted@north.test`
 *   `meta.sdkVersion` is the Agent SDK pinned in `packages/agents/package.json`
 *   unless scrubbing changed the request (`meta.requestScrubbed`), the key
 *     recomputed from the stored path, `anthropic-beta` header and body is the
 *     file name (a hand-edited request fails; a pre-meta cassette, whose
 *     scrubbing is unknown, only warns "unverifiable")
 *
 * and nothing else lives in the directory but `README.md`. Usage:
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
import { CassetteFileSchema, cassetteKey, sdkVersionOf, type CassetteFile, type CassetteMeta } from "../apps/worker/src/gateway/cassette";

/** Re-exported so the gateway's reading of the user agent and this check's are one function. */
export { sdkVersionOf };

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_SDK = "@anthropic-ai/claude-agent-sdk";

// ---- secrets ------------------------------------------------------------------

// The patterns `scrubCassette` removes from a request, minus the forms it leaves behind:
// `sk-ant-REDACTED` (not when more key characters follow), `Bearer REDACTED` (shorter than a token) and `redacted@north.test`.
const ANTHROPIC_KEY = /sk-ant-(?!REDACTED(?![A-Za-z0-9_-]))[A-Za-z0-9_-]+/;
const BEARER_TOKEN = /Bearer [A-Za-z0-9._~+/-]{16,}=*/;
const NORTH_TEST_DOMAIN = /@north\.test\b/gi;
const LOCAL_PART_CHAR = /[A-Za-z0-9._%+-]/;
const REDACTED_ADDRESS = "redacted@north.test";
const REDACTED_LOCAL_PART = "redacted";

/**
 * True when `text` holds an address under `@north.test` whose local part (the
 * run of `[A-Za-z0-9._%+-]` before the `@`) is not `redacted`. Found from the
 * domain backwards: the scrubber's own pattern (`<local>@north.test`, local
 * first) is quadratic on a long unbroken run such as a base64 body, and this
 * reads each run once.
 */
function holdsOpenAddress(text: string): boolean {
  for (const match of text.matchAll(NORTH_TEST_DOMAIN)) {
    let start = match.index;
    while (start > 0 && LOCAL_PART_CHAR.test(text.charAt(start - 1))) start -= 1;
    const local = text.slice(start, match.index);
    if (local !== "" && local !== REDACTED_LOCAL_PART) return true;
  }
  return false;
}

/**
 * The kinds of secret `text` holds, each named once, in words: an Anthropic key,
 * a bearer token, a `@north.test` address that is not `redacted@north.test`.
 * Empty for clean text, including text the gateway's scrubber has already
 * cleaned. Never returns the secret itself.
 */
export function secretFindings(text: string): readonly string[] {
  const found: string[] = [];
  if (ANTHROPIC_KEY.test(text)) found.push("an Anthropic key (sk-ant-...)");
  if (BEARER_TOKEN.test(text)) found.push("a bearer token (Bearer ...)");
  if (holdsOpenAddress(text)) found.push(`a @north.test address other than ${REDACTED_ADDRESS}`);
  return found;
}

/** Bytes to characters one to one (latin1), as the gateway scrubs: the patterns are ASCII, so no byte can hide from them. */
const decoded = (base64: string): string => Buffer.from(base64, "base64").toString("latin1");

/** Where a secret may sit: each body decoded, and the file text (headers, path, any other field). */
function secretProblems(text: string, data: CassetteFile): string[] {
  const places: ReadonlyArray<readonly [string, string]> = [
    ["request body", decoded(data.request.body)],
    ["response body", decoded(data.response.body)],
    ["headers, path or another field", text],
  ];
  return places.flatMap(([place, content]) => secretFindings(content).map((kind) => `${place} holds ${kind}`));
}

// ---- one file -----------------------------------------------------------------

/** A cassette file as read: its name in the directory and its text. */
export interface CassetteInput {
  readonly name: string;
  readonly text: string;
}

/** What the check found in one file: the reasons it fails and the reasons it only warns. */
export interface Verdict {
  readonly name: string;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
}

const verdict = (name: string, failures: readonly string[], warnings: readonly string[]): Verdict => Object.freeze({ name, failures: Object.freeze([...failures]), warnings: Object.freeze([...warnings]) });

type Parsed = { readonly ok: true; readonly data: CassetteFile } | { readonly ok: false; readonly reason: string };

/** The file as the gateway's schema reads it; the reason when it is not JSON or not a cassette. */
function parseFile(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the file is not JSON" };
  }
  const parsed = CassetteFileSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, reason: `not a valid cassette: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")}` };
}

const betaOf = (headers: Readonly<Record<string, string>>): string => Object.entries(headers).find(([name]) => name.toLowerCase() === "anthropic-beta")?.[1] ?? "";

/** Why the key cannot be recomputed from the stored request, or does not come out as the file's key; null when it does. */
function rehashProblem(data: CassetteFile): string | null {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(data.request.body, "base64").toString("utf8"));
  } catch {
    return "the stored request body is not JSON, so its key cannot be recomputed";
  }
  const recomputed = cassetteKey({ path: data.request.path, betaHeader: betaOf(data.request.headers), body });
  return recomputed === data.key ? null : `the key recomputed from the stored request (path, anthropic-beta, body) is ${recomputed}, not ${data.key}: the request was edited, or the key rules changed since it was recorded`;
}

/**
 * The key check. Skipped when `meta` says scrubbing changed the request. A
 * cassette with no `meta` was recorded before scrubbing was written down, so a
 * request that no longer hashes to its name is only "unverifiable" there.
 */
function keyFindings(data: CassetteFile): { readonly failures: string[]; readonly warnings: string[] } {
  const problem = data.meta?.requestScrubbed === true ? null : rehashProblem(data);
  if (problem === null) return { failures: [], warnings: [] };
  return data.meta === undefined ? { failures: [], warnings: [`unverifiable (pre-meta cassette): ${problem}`] } : { failures: [problem], warnings: [] };
}

/** A recording by another Agent SDK than the pin is stale (null when it names none, or the same). */
function sdkProblem(meta: CassetteMeta | undefined, pin: string): string | null {
  const recorded = meta?.sdkVersion ?? null;
  if (recorded === null || recorded === pin) return null;
  return `recorded with Agent SDK ${recorded}, but packages/agents/package.json pins ${pin}: re-record it (the nightly job does)`;
}

/**
 * Every problem of one cassette file against the Agent SDK `pin`, all at once.
 * Pure: reads nothing, changes nothing.
 */
export function verdictFor(file: CassetteInput, pin: string): Verdict {
  const parsed = parseFile(file.text);
  if (!parsed.ok) return verdict(file.name, [parsed.reason], []);
  const { data } = parsed;
  const keys = keyFindings(data);
  const sdk = sdkProblem(data.meta, pin);
  const failures = [
    ...(file.name === `${data.key}.json` ? [] : [`the file name does not match its key ${data.key}: a renamed or copied cassette`]),
    ...secretProblems(file.text, data),
    ...(sdk === null ? [] : [sdk]),
    ...keys.failures,
  ];
  return verdict(file.name, failures, keys.warnings);
}

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
