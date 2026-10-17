/**
 * TST-4: the pure parts of `pnpm evidence:costs` (`evidence-costs.ts`), kept
 * apart so each is tested alone (`evidence-costs.test.ts`): the plan read from
 * the flags and the environment, the per-task summary of a company's
 * `agent_runs` and the schema of the redacted `run.json`. Nothing here reads
 * the network, the database or a key, and nothing changes its input.
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";
import { isLoopbackHost, summariseRuns, type SmokeRun } from "./smoke-llm-helpers";

/** One `agent_runs` row as the summary reads it (the smoke's shape). */
export type EvidenceRun = SmokeRun;

/** One task of the company as the summary reads it. */
export interface EvidenceTask {
  readonly id: string;
  readonly taskType: string;
  readonly status: string;
}

/** The company the journey created; its id is only ever written hashed. */
export interface EvidenceCompany {
  readonly slug: string;
  readonly id: string;
}

/** A company slug as the database allows it (`companies.slug` check). */
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SHA = /^[0-9a-f]{7,64}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL = /[^\s"'<>@]+@[^\s"'<>@]+\.[a-z]{2,}/i;

/** The first 12 hex characters of the id's SHA-256: enough to tell two runs' companies apart, never the id. */
export const idHash = (id: string): string => createHash("sha256").update(id).digest("hex").slice(0, 12);

/** Throws when the serialised value holds a uuid or an email address: `run.json` is committed as evidence. */
export function assertRedacted(value: unknown): void {
  const text = JSON.stringify(value);
  if (UUID.test(text)) throw new Error("run.json would hold a uuid: ids are written hashed or not at all");
  if (EMAIL.test(text)) throw new Error("run.json would hold an email address: addresses are never written");
}

const TaskLineSchema = z.strictObject({
  taskType: z.string().min(1),
  status: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

/** `run.json`: the commit, the worker's profile, the company by slug and hashed id, one line per task, the total; checked redacted. */
export const RunJsonSchema = z
  .strictObject({
    sha: z.string().min(1),
    profile: z.string().min(1).nullable(),
    company: z.strictObject({ slug: z.string().regex(SLUG), idHash: z.string().regex(/^[0-9a-f]{12}$/) }),
    tasks: z.array(TaskLineSchema),
    totalCostUsd: z.number().nonnegative(),
    redacted: z.literal(true),
  })
  .superRefine((value, ctx) => {
    try {
      assertRedacted(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
    }
  });
export type RunJson = z.infer<typeof RunJsonSchema>;

/**
 * The redacted summary: one line per task (in the tasks' order) with every
 * model its runs used, their tokens, cost and duration; the total counts
 * every run of the company. No task id, no company id (hashed), no address.
 */
export function summariseEvidence(runs: readonly EvidenceRun[], tasks: readonly EvidenceTask[], sha: string, profile: string | null, company: EvidenceCompany): RunJson {
  const summary = summariseRuns(
    runs,
    tasks.map((t) => ({ id: t.id, taskType: t.taskType, status: t.status, evidenceKind: null })),
  );
  const lines = summary.tasks.map((t) =>
    Object.freeze({ taskType: t.taskType, status: t.status, model: t.model, inputTokens: t.inputTokens, outputTokens: t.outputTokens, costUsd: t.costUsd, durationMs: t.durationMs }),
  );
  return Object.freeze({
    sha,
    profile,
    company: Object.freeze({ slug: company.slug, idHash: idHash(company.id) }),
    tasks: Object.freeze(lines) as RunJson["tasks"],
    totalCostUsd: summary.totalCostUsd,
    redacted: true as const,
  });
}

/** What one run of the script does. Holds no key: the script reads `SUPABASE_SERVICE_ROLE_KEY` itself, once. */
export interface EvidenceCostsPlan {
  readonly slug: string;
  /** Absolute, or relative to the repository root. */
  readonly outDir: string;
  readonly supabaseUrl: string;
  /** `EVIDENCE_WORKER_URL` without a trailing slash; null means the profile is not read. */
  readonly workerUrl: string | null;
  /** `EVIDENCE_SHA`, else `GITHUB_SHA`; null means the script asks git. */
  readonly sha: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;
const usage = (message: string): Error => new Error(`evidence costs usage: ${message}`);
const valueOf = (env: Env, name: string): string | null => {
  const trimmed = (env[name] ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

function flagsFrom(argv: readonly string[]): { readonly slug?: string; readonly out?: string } {
  try {
    const { values } = parseArgs({ args: argv.filter((a) => a !== "--"), options: { slug: { type: "string" }, out: { type: "string" } }, strict: true, allowPositionals: false });
    return values;
  } catch (error) {
    throw usage(`${error instanceof Error ? error.message : String(error)} (flags: --slug <company slug>, --out <dir>)`);
  }
}

/** `E2E_EVIDENCE_DATE` (the spec's directory) or the UTC day of `now`. */
function dayOf(env: Env, now: Date): string {
  const day = valueOf(env, "E2E_EVIDENCE_DATE");
  if (day === null) return now.toISOString().slice(0, 10);
  if (!DAY.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) throw usage("E2E_EVIDENCE_DATE must be YYYY-MM-DD");
  return day;
}

/** The database at `url` may be read: loopback, or any host with `EVIDENCE_ALLOW_REMOTE_DB=1` (the staging workflow sets it). */
function checkDatabase(url: string, allowRemote: boolean): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw usage("SUPABASE_URL is not a URL");
  }
  if (!allowRemote && !isLoopbackHost(host)) throw new Error(`evidence costs refuses: the database ${host} is not this machine; set EVIDENCE_ALLOW_REMOTE_DB=1 to read it (the staging workflow does)`);
}

/** The plan from `--slug`/`--out` (or `EVIDENCE_COMPANY_SLUG`), the Supabase env, `EVIDENCE_WORKER_URL` and the sha. */
export function evidenceCostsPlan(env: Env, argv: readonly string[], now: Date): EvidenceCostsPlan {
  const flags = flagsFrom(argv);
  const slug = flags.slug?.trim() || valueOf(env, "EVIDENCE_COMPANY_SLUG");
  if (!slug) throw usage("pass --slug <company slug> or set EVIDENCE_COMPANY_SLUG");
  if (!SLUG.test(slug)) throw usage("the company slug must be lowercase letters, digits and hyphens");
  const supabaseUrl = valueOf(env, "SUPABASE_URL");
  if (supabaseUrl === null) throw usage("SUPABASE_URL is not set (the project whose agent_runs to read)");
  if (valueOf(env, "SUPABASE_SERVICE_ROLE_KEY") === null) throw usage("SUPABASE_SERVICE_ROLE_KEY is not set (the service role reads every run)");
  checkDatabase(supabaseUrl, valueOf(env, "EVIDENCE_ALLOW_REMOTE_DB") === "1");
  const worker = valueOf(env, "EVIDENCE_WORKER_URL");
  if (worker !== null && !z.url({ protocol: /^https?$/ }).safeParse(worker).success) throw usage("EVIDENCE_WORKER_URL must be an http(s) URL");
  const sha = valueOf(env, "EVIDENCE_SHA") ?? valueOf(env, "GITHUB_SHA");
  if (sha !== null && !SHA.test(sha)) throw usage("EVIDENCE_SHA / GITHUB_SHA must be a commit sha");
  return Object.freeze({
    slug,
    outDir: flags.out?.trim() || `docs/evidence/M7/acceptance/${dayOf(env, now)}`,
    supabaseUrl,
    workerUrl: worker === null ? null : worker.replace(/\/+$/, ""),
    sha,
  });
}
