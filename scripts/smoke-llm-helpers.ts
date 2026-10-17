/**
 * TST-2: the pure parts of the real-Claude smoke (`scripts/smoke-llm.ts`), kept
 * apart so each one is tested alone (`smoke-llm.test.ts`): the plan read from
 * the environment and the flags, the markdown check of the market report, the
 * per-task summary of `agent_runs`, the verdict over everything the run left
 * behind and the evidence file. Nothing here reads the network, the database
 * or a key, and nothing changes its input.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import type { AgentRole, MetricKey, TaskType } from "@north/core";

/** The most the two smoke tasks may cost together (the gateway's `NORTH_DAILY_CAP_USD=0.50` is the hard stop; this checks `agent_runs`). */
export const SMOKE_LLM_MAX_COST_USD = 0.5;
/** Where a real (SDK runtime) run's evidence file lands when `SMOKE_LLM_OUT` is unset (read from the repo root): the proof path. */
export const DEFAULT_SMOKE_LLM_OUT = "docs/evidence/M7/smoke-llm.json";
/** Where a mock run's file lands when `SMOKE_LLM_OUT` is unset: never the proof path. */
export const MOCK_SMOKE_LLM_OUT = "docs/evidence/M7/smoke-llm.mock.json";
/** Where a run against a replaying gateway lands when `SMOKE_LLM_OUT` is unset: tape is not real Claude, so never the proof path. */
export const REPLAY_SMOKE_LLM_OUT = "docs/evidence/M7/smoke-llm.replay.json";
/** The fewest `##` sections a market report must have. */
export const MIN_REPORT_HEADINGS = 3;
const DEFAULT_TIMEOUT_MS = 420_000;
const MAX_TIMEOUT_MS = 3_600_000;
const DEFAULT_WORKER_URL = "http://localhost:3101";
const DEFAULT_INNGEST_URL = "http://localhost:8288";

/** The two runtimes the worker can run agents on. */
export const SMOKE_RUNTIMES = Object.freeze(["mock", "claude-agent-sdk"] as const);
/** One of {@link SMOKE_RUNTIMES}. */
export type SmokeRuntime = (typeof SMOKE_RUNTIMES)[number];

/** The modes of the worker's model gateway (`/health` `gateway`; `off` there means no gateway and is `null` here). */
export const SMOKE_GATEWAYS = Object.freeze(["live", "record", "replay"] as const);
/** One of {@link SMOKE_GATEWAYS}. */
export type SmokeGateway = (typeof SMOKE_GATEWAYS)[number];

/** One task the smoke creates and dispatches through `task/dispatch`. */
export interface SmokeTaskSpec {
  readonly role: AgentRole;
  readonly taskType: TaskType;
  readonly title: string;
  readonly input: string;
  readonly metricKey: MetricKey | null;
  readonly expectedDelta: number | null;
}

/** A market report capped at three web searches, and the smallest landing page the build guide allows; the role YAML's `max_turns` and `max_budget_usd` stay. */
export const SMOKE_TASKS: readonly SmokeTaskSpec[] = Object.freeze([
  Object.freeze({
    role: "research",
    taskType: "market_report",
    title: "Smoke: market report",
    input: "TST-2 smoke run on the smoke profile. Keep the report short (about 400 words). Use at most 3 web searches in total and fetch at most 2 pages; label every figure you cannot source as an estimate.",
    metricKey: null,
    expectedDelta: null,
  }),
  Object.freeze({
    role: "engineering",
    taskType: "build_site",
    title: "Smoke: landing page",
    input: "TST-2 smoke run on the smoke profile. Build the smallest landing page the guide allows: index.html with inline CSS and a README.md, no other files, short copy. Do not search the web.",
    metricKey: "signups",
    expectedDelta: 1,
  }),
] satisfies SmokeTaskSpec[]);

/** What one smoke run does: read from the environment and the flags by {@link planFor}. Never holds a key. */
export interface SmokePlan {
  readonly dryRun: boolean;
  /** `--runtime`; null means the runtime the worker's `/health` reports. */
  readonly runtime: SmokeRuntime | null;
  readonly timeoutMs: number;
  /** `SMOKE_LLM_OUT` (absolute, or relative to the repo root); null means the default for the runtime ({@link evidencePathFor}). */
  readonly outPath: string | null;
  readonly workerUrl: string;
  readonly inngestUrl: string;
  readonly maxCostUsd: number;
  /** `SMOKE_LLM_SHA` (CI: the pull request's head), else `GITHUB_SHA`; null locally (the script asks git). */
  readonly sha: string | null;
  /** `SMOKE_LLM_ALLOW_REMOTE_DB=1`: the database may be another machine (default: loopback only). */
  readonly allowRemoteDb: boolean;
  readonly tasks: readonly SmokeTaskSpec[];
}

/** Trimmed; a blank value counts as unset. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), schema.optional());
const SHA = /^[0-9a-f]{7,64}$/i;
const url = optional(z.url({ protocol: /^https?$/ }).transform((u) => u.replace(/\/+$/, "")));

const EnvSchema = z.object({
  SMOKE_LLM_TIMEOUT_MS: optional(z.coerce.number().int().positive().max(MAX_TIMEOUT_MS)),
  SMOKE_LLM_OUT: optional(z.string()),
  NORTH_WORKER_URL: url,
  INNGEST_BASE_URL: url,
  SMOKE_LLM_SHA: optional(z.string().regex(SHA)),
  GITHUB_SHA: optional(z.string().regex(SHA)),
  SMOKE_LLM_ALLOW_REMOTE_DB: optional(z.enum(["0", "1"], { error: "must be 0 or 1" })),
  SUPABASE_URL: optional(z.string()),
  NEXT_PUBLIC_SUPABASE_URL: optional(z.string()),
  NORTH_ENV: optional(z.string()),
  INTEGRATIONS_MODE: optional(z.string()),
});

const FlagsSchema = z.object({
  "dry-run": z.boolean().optional(),
  runtime: z.enum(SMOKE_RUNTIMES, { error: "--runtime must be mock or claude-agent-sdk" }).optional(),
});

const issuesOf = (error: z.ZodError): string => error.issues.map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");

function flagsFrom(argv: readonly string[]): z.infer<typeof FlagsSchema> {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== "--"),
    options: { "dry-run": { type: "boolean" }, runtime: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const flags = FlagsSchema.safeParse(values);
  if (!flags.success) throw new Error(`smoke LLM usage: ${issuesOf(flags.error)} (flags: --dry-run, --runtime mock|claude-agent-sdk)`);
  return flags.data;
}

const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "[::1]"]);

/**
 * Null when the smoke may create its user and company in the database at
 * `url`: a loopback host, or any host with `allowRemote`
 * (`SMOKE_LLM_ALLOW_REMOTE_DB=1`). Otherwise the refusal, naming the host.
 */
export function databaseRefusal(url: string, allowRemote: boolean): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "the database URL is not a URL: smoke LLM creates a user and a company there and refuses to guess";
  }
  if (allowRemote || LOOPBACK_HOSTS.has(host) || IPV4_LOOPBACK.test(host)) return null;
  return `the database ${host} is not this machine: smoke LLM creates a user and a company there; set SMOKE_LLM_ALLOW_REMOTE_DB=1 to allow it`;
}

/**
 * The evidence file for a run on `runtime` against a gateway in `gateway` mode
 * (null: none): `SMOKE_LLM_OUT` when set, else `smoke-llm.mock.json` for the
 * mock, `smoke-llm.replay.json` for a replaying gateway, and the proof path
 * only for the SDK runtime against a live or recording one.
 */
export function evidencePathFor(outPath: string | null, runtime: SmokeRuntime, gateway: SmokeGateway | null): string {
  if (outPath !== null) return outPath;
  if (runtime === "mock") return MOCK_SMOKE_LLM_OUT;
  return gateway === "replay" ? REPLAY_SMOKE_LLM_OUT : DEFAULT_SMOKE_LLM_OUT;
}

/**
 * The plan for one run, from the environment and the flags (`--dry-run`,
 * `--runtime mock|claude-agent-sdk`; a lone `--` is dropped). Refuses an
 * environment that names production (`NORTH_ENV=production`), live
 * integrations (`INTEGRATIONS_MODE=live`) or a database that is not this
 * machine (`SUPABASE_URL`, unless `SMOKE_LLM_ALLOW_REMOTE_DB=1`); the health
 * gate refuses the same on the worker's own line. Reads no key: the worker
 * holds `ANTHROPIC_API_KEY`.
 */
export function planFor(env: Readonly<Record<string, string | undefined>>, argv: readonly string[] = []): SmokePlan {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`smoke LLM usage: ${issuesOf(parsed.error)}`);
  const e = parsed.data;
  if (e.NORTH_ENV === "production") throw new Error("smoke LLM refuses NORTH_ENV=production: it creates a user and a company and spends model money; run it against the local or a staging stack");
  if (e.INTEGRATIONS_MODE === "live") throw new Error("smoke LLM refuses INTEGRATIONS_MODE=live: it runs on sandbox integrations only");
  const allowRemoteDb = e.SMOKE_LLM_ALLOW_REMOTE_DB === "1";
  const dbUrl = e.SUPABASE_URL ?? e.NEXT_PUBLIC_SUPABASE_URL;
  const refusal = dbUrl === undefined ? null : databaseRefusal(dbUrl, allowRemoteDb);
  if (refusal) throw new Error(`smoke LLM refuses: ${refusal}`);
  const flags = flagsFrom(argv);
  return Object.freeze({
    dryRun: flags["dry-run"] === true,
    runtime: flags.runtime ?? null,
    timeoutMs: e.SMOKE_LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    outPath: e.SMOKE_LLM_OUT ?? null,
    workerUrl: e.NORTH_WORKER_URL ?? DEFAULT_WORKER_URL,
    inngestUrl: e.INNGEST_BASE_URL ?? DEFAULT_INNGEST_URL,
    maxCostUsd: SMOKE_LLM_MAX_COST_USD,
    sha: e.SMOKE_LLM_SHA ?? e.GITHUB_SHA ?? null,
    allowRemoteDb,
    tasks: SMOKE_TASKS,
  });
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LEVEL_TWO = /^ {0,3}##[ \t]+\S/;

/** The `##` headings of a markdown text outside code fences (a fence closes only on its own character, at least as long, alone on its line). */
export function countMarkdownHeadings(text: string): number {
  let fence: { readonly char: string; readonly length: number } | null = null;
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null;
    } else if (marker) {
      fence = { char: marker[0] ?? "`", length: marker.length };
    } else if (LEVEL_TWO.test(line)) {
      count += 1;
    }
  }
  return count;
}

/** The count of `##` headings; throws naming the count when there are fewer than `min`. */
export function assertMarkdownHeadings(text: string, min: number): number {
  const count = countMarkdownHeadings(text);
  if (count < min) throw new Error(`the market report has ${count} \`##\` headings; at least ${min} required`);
  return count;
}

/** One `agent_runs` row as the summary reads it. */
export interface SmokeRun {
  readonly taskId: string | null;
  readonly model: string;
  readonly runtime: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
}

/** One smoke task as the summary reads it. */
export interface SmokeTaskState {
  readonly id: string;
  readonly taskType: string;
  readonly status: string;
  readonly evidenceKind: string | null;
}

/** One line of `smoke-llm.json`'s `tasks`. */
export interface SmokeTaskRow {
  readonly taskType: string;
  readonly status: string;
  /** Every model the task's runs used, first seen first; `none` when it has no run. */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly evidenceKind: string | null;
}

/** The per-task rows, the company's total cost and the runtimes the smoke tasks ran on. */
export interface SmokeSummary {
  readonly tasks: readonly SmokeTaskRow[];
  readonly totalCostUsd: number;
  readonly runtimes: readonly string[];
}

/** Dollar sums rounded to a millionth, so `0.1 + 0.2` reads 0.3. */
export const usd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const distinct = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)]);

function rowFor(task: SmokeTaskState, runs: readonly SmokeRun[]): SmokeTaskRow {
  const own = runs.filter((r) => r.taskId === task.id);
  const sum = (pick: (r: SmokeRun) => number): number => own.reduce((total, r) => total + pick(r), 0);
  const models = distinct(own.map((r) => r.model));
  return Object.freeze({
    taskType: task.taskType,
    status: task.status,
    model: models.length > 0 ? models.join(", ") : "none",
    inputTokens: sum((r) => r.inputTokens),
    outputTokens: sum((r) => r.outputTokens),
    costUsd: usd(sum((r) => r.costUsd)),
    durationMs: sum((r) => r.durationMs),
    evidenceKind: task.evidenceKind,
  });
}

/** One row per smoke task (in the tasks' order) from the company's `agent_runs`; the total counts every run of the company. */
export function summariseRuns(runs: readonly SmokeRun[], tasks: readonly SmokeTaskState[]): SmokeSummary {
  const ids = new Set(tasks.map((t) => t.id));
  return Object.freeze({
    tasks: Object.freeze(tasks.map((t) => rowFor(t, runs))),
    totalCostUsd: usd(runs.reduce((total, r) => total + r.costUsd, 0)),
    runtimes: distinct(runs.filter((r) => r.taskId !== null && ids.has(r.taskId)).map((r) => r.runtime)),
  });
}

/** An error's message (or the thrown value as text). */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Runs `work`; a throw becomes a problem line (`label: message`) and the fallback's value, so the table and the evidence file still come out. */
export async function attempt<T>(label: string, work: () => Promise<T>, fallback: () => Promise<T> | T): Promise<{ readonly value: T; readonly problem: string | null }> {
  try {
    return Object.freeze({ value: await work(), problem: null });
  } catch (error) {
    return Object.freeze({ value: await fallback(), problem: `${label}: ${messageOf(error)}` });
  }
}

/** One action of the build task as the preview pick reads it. */
export interface PreviewAction {
  readonly kind: string;
  readonly status: string;
  readonly externalRef: string | null;
  readonly createdAt: string;
}

/** The build's `deploy.preview`: the one whose URL is the task's evidence, else the newest; null without one. */
export function pickPreview<T extends PreviewAction>(actions: readonly T[], evidenceRef: string | null): T | null {
  const previews = actions.filter((a) => a.kind === "deploy.preview");
  const evidenced = evidenceRef === null ? undefined : previews.find((a) => a.externalRef === evidenceRef);
  return evidenced ?? previews.reduce<T | null>((newest, a) => (newest === null || a.createdAt > newest.createdAt ? a : newest), null);
}

/** The evidence file `smoke-llm.json` (or `smoke-llm.mock.json`, `smoke-llm.replay.json`). */
export interface SmokeReport {
  readonly sha: string;
  readonly profile: string;
  readonly runtime: SmokeRuntime;
  /** The gateway's mode read from `/health` (`live`, `record` or `replay`); null without a gateway (the mock runtime). */
  readonly gateway: SmokeGateway | null;
  readonly tasks: readonly SmokeTaskRow[];
  /** The ledger: every `agent_runs.cost_usd` of the company. */
  readonly totalCostUsd: number;
  /** The gateway's priced spend during the run (the spend truth); null on the mock runtime or when it could not be read. */
  readonly gatewaySpentUsd: number | null;
}

/** What {@link buildReport} is made from. */
export interface ReportInput {
  readonly sha: string;
  readonly profile: string;
  readonly runtime: SmokeRuntime;
  readonly gateway: SmokeGateway | null;
  readonly summary: SmokeSummary;
  readonly gatewaySpentUsd: number | null;
}

/** The evidence file: `{ sha, profile, runtime, gateway, tasks, totalCostUsd, gatewaySpentUsd }`, each task row with exactly the evidence fields. */
export function buildReport(input: ReportInput): SmokeReport {
  const tasks = input.summary.tasks.map((t) =>
    Object.freeze({ taskType: t.taskType, status: t.status, model: t.model, inputTokens: t.inputTokens, outputTokens: t.outputTokens, costUsd: t.costUsd, durationMs: t.durationMs, evidenceKind: t.evidenceKind }),
  );
  return Object.freeze({ sha: input.sha, profile: input.profile, runtime: input.runtime, gateway: input.gateway, tasks: Object.freeze(tasks), totalCostUsd: input.summary.totalCostUsd, gatewaySpentUsd: input.gatewaySpentUsd });
}

const COLUMNS = [16, 18, 30, 9, 8, 10, 9] as const;
const line = (cells: readonly string[]): string => cells.map((c, i) => c.padEnd(COLUMNS[i] ?? 0)).join("").trimEnd();

/** The per-task table the script prints on success and on failure, with the ledger's total and the gateway's spend during the run. */
export function formatTable(summary: SmokeSummary, spend: { readonly runtime: SmokeRuntime; readonly gatewayUsd: number | null }): string {
  const head = line(["task", "status", "model", "in", "out", "cost", "time", "evidence"]);
  const rows = summary.tasks.map((t) => line([t.taskType, t.status, t.model, String(t.inputTokens), String(t.outputTokens), `$${t.costUsd.toFixed(4)}`, `${(t.durationMs / 1000).toFixed(1)} s`, t.evidenceKind ?? "none"]));
  const gateway = spend.runtime === "mock" ? "gateway none (mock runtime)" : spend.gatewayUsd === null ? "gateway unread" : `gateway $${spend.gatewayUsd.toFixed(4)} (priced during the run)`;
  return [head, ...rows, `total: ledger $${summary.totalCostUsd.toFixed(4)} (every run of the company), ${gateway}`].join("\n");
}

/** `smoke LLM: OK (ledger $0.12, gateway $0.14), runtime claude-agent-sdk`, or `smoke LLM: OK (mock runtime: ledger $0.00, no gateway)`. */
export function okLine(input: { readonly runtime: SmokeRuntime; readonly ledgerUsd: number; readonly gatewayUsd: number | null }): string {
  const ledger = `ledger $${input.ledgerUsd.toFixed(2)}`;
  if (input.gatewayUsd === null) return `smoke LLM: OK (${input.runtime} runtime: ${ledger}, no gateway)`;
  return `smoke LLM: OK (${ledger}, gateway $${input.gatewayUsd.toFixed(2)}), runtime ${input.runtime}`;
}
