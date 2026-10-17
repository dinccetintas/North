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
/** Where the evidence file lands when `SMOKE_LLM_OUT` is unset (read from the repo root). */
export const DEFAULT_SMOKE_LLM_OUT = "docs/evidence/M7/smoke-llm.json";
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
  /** Absolute, or relative to the repo root. */
  readonly outPath: string;
  readonly workerUrl: string;
  readonly inngestUrl: string;
  readonly maxCostUsd: number;
  /** `GITHUB_SHA` in CI; null locally (the script asks git). */
  readonly sha: string | null;
  readonly tasks: readonly SmokeTaskSpec[];
}

/** Trimmed; a blank value counts as unset. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), schema.optional());
const url = optional(z.url({ protocol: /^https?$/ }).transform((u) => u.replace(/\/+$/, "")));

const EnvSchema = z.object({
  SMOKE_LLM_TIMEOUT_MS: optional(z.coerce.number().int().positive().max(MAX_TIMEOUT_MS)),
  SMOKE_LLM_OUT: optional(z.string()),
  NORTH_WORKER_URL: url,
  INNGEST_BASE_URL: url,
  GITHUB_SHA: optional(z.string().regex(/^[0-9a-f]{7,64}$/i)),
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

/**
 * The plan for one run, from the environment and the flags (`--dry-run`,
 * `--runtime mock|claude-agent-sdk`; a lone `--` is dropped). Refuses an
 * environment that names production (`NORTH_ENV=production`) or live
 * integrations (`INTEGRATIONS_MODE=live`); the health gate refuses the same on
 * the worker's own line. Reads no key: the worker holds `ANTHROPIC_API_KEY`.
 */
export function planFor(env: Readonly<Record<string, string | undefined>>, argv: readonly string[] = []): SmokePlan {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`smoke LLM usage: ${issuesOf(parsed.error)}`);
  const e = parsed.data;
  if (e.NORTH_ENV === "production") throw new Error("smoke LLM refuses NORTH_ENV=production: it creates a user and a company and spends model money; run it against the local or a staging stack");
  if (e.INTEGRATIONS_MODE === "live") throw new Error("smoke LLM refuses INTEGRATIONS_MODE=live: it runs on sandbox integrations only");
  const flags = flagsFrom(argv);
  return Object.freeze({
    dryRun: flags["dry-run"] === true,
    runtime: flags.runtime ?? null,
    timeoutMs: e.SMOKE_LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    outPath: e.SMOKE_LLM_OUT ?? DEFAULT_SMOKE_LLM_OUT,
    workerUrl: e.NORTH_WORKER_URL ?? DEFAULT_WORKER_URL,
    inngestUrl: e.INNGEST_BASE_URL ?? DEFAULT_INNGEST_URL,
    maxCostUsd: SMOKE_LLM_MAX_COST_USD,
    sha: e.GITHUB_SHA ?? null,
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
const usd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
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

/** How a smoke task ended. */
export interface SmokeTaskOutcome {
  readonly taskType: string;
  readonly status: string;
  readonly evidence: { readonly kind: string; readonly verified: boolean } | null;
  readonly lastError: string | null;
}

/** Everything the verdict reads, gathered by the script after the tasks settle. */
export interface SmokeFacts {
  readonly runtime: SmokeRuntime;
  readonly maxCostUsd: number;
  readonly tasks: readonly SmokeTaskOutcome[];
  readonly summary: SmokeSummary;
  /** The artifact the market report task's evidence names; null when it names none. */
  readonly marketReport: { readonly kind: string; readonly markdown: string } | null;
  /** The build task's head `deploy.preview` action and what its URL answered. */
  readonly preview: { readonly status: string | null; readonly url: string | null; readonly httpStatus: number | null };
}

/** K1 completes an executed action as `notified` (executed, the CEO told); K0 as `executed`. Either means it ran. */
const RAN = new Set(["executed", "notified"]);

function taskProblems(tasks: readonly SmokeTaskOutcome[]): string[] {
  return tasks.flatMap((t) => {
    if (t.status !== "done") return [`${t.taskType} is ${t.status}${t.lastError ? `: ${t.lastError}` : ""}`];
    return t.evidence?.verified ? [] : [`${t.taskType} is done without verified evidence`];
  });
}

function reportProblems(report: SmokeFacts["marketReport"]): string[] {
  if (!report) return ["no market report artifact: the market_report task's evidence names none"];
  if (report.kind !== "market_report") return [`the market report's evidence is an artifact of kind "${report.kind}"`];
  try {
    assertMarkdownHeadings(report.markdown, MIN_REPORT_HEADINGS);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function previewProblems(preview: SmokeFacts["preview"]): string[] {
  if (preview.status === null) return ["the build task has no deploy.preview action"];
  if (!RAN.has(preview.status)) return [`deploy.preview is ${preview.status}, not executed`];
  if (preview.url === null) return ["deploy.preview ran but recorded no URL"];
  return preview.httpStatus === 200 ? [] : [`the preview ${preview.url} answered ${preview.httpStatus ?? "nothing"}, not 200`];
}

function runProblems(facts: SmokeFacts): string[] {
  const { summary, runtime, maxCostUsd } = facts;
  const cost = summary.totalCostUsd > maxCostUsd ? [`agent runs cost $${summary.totalCostUsd.toFixed(4)}, over the $${maxCostUsd.toFixed(2)} cap`] : [];
  const others = summary.runtimes.filter((r) => r !== runtime);
  const foreign = others.length > 0 ? [`smoke tasks ran on runtime ${others.join(", ")}, not ${runtime}`] : [];
  const silent = runtime === "claude-agent-sdk" ? summary.tasks.filter((t) => t.inputTokens + t.outputTokens === 0).map((t) => `${t.taskType} recorded no tokens on the SDK runtime`) : [];
  return [...cost, ...foreign, ...silent];
}

/**
 * Every problem with the run at once (empty when it passed): both tasks done
 * with verified evidence (a gateway 402 shows up as a failed task with its
 * reason), the market report a `market_report` artifact with at least three
 * `##` headings, the build's `deploy.preview` ran and answers 200, the
 * company's `agent_runs` cost at most the cap, and on the SDK runtime every
 * smoke task ran on it with real tokens.
 */
export function smokeProblems(facts: SmokeFacts): readonly string[] {
  return Object.freeze([...taskProblems(facts.tasks), ...reportProblems(facts.marketReport), ...previewProblems(facts.preview), ...runProblems(facts)]);
}

/** The evidence file `smoke-llm.json`. */
export interface SmokeReport {
  readonly sha: string;
  readonly profile: string;
  readonly tasks: readonly SmokeTaskRow[];
  readonly totalCostUsd: number;
}

/** `smoke-llm.json`: `{ sha, profile, tasks, totalCostUsd }`, each task row with exactly the evidence fields. */
export function buildReport(input: { readonly sha: string; readonly profile: string; readonly summary: SmokeSummary }): SmokeReport {
  const tasks = input.summary.tasks.map((t) =>
    Object.freeze({ taskType: t.taskType, status: t.status, model: t.model, inputTokens: t.inputTokens, outputTokens: t.outputTokens, costUsd: t.costUsd, durationMs: t.durationMs, evidenceKind: t.evidenceKind }),
  );
  return Object.freeze({ sha: input.sha, profile: input.profile, tasks: Object.freeze(tasks), totalCostUsd: input.summary.totalCostUsd });
}

const COLUMNS = [16, 18, 30, 9, 8, 10, 9] as const;
const line = (cells: readonly string[]): string => cells.map((c, i) => c.padEnd(COLUMNS[i] ?? 0)).join("").trimEnd();

/** The per-task table the script prints on success and on failure. */
export function formatTable(summary: SmokeSummary): string {
  const head = line(["task", "status", "model", "in", "out", "cost", "time", "evidence"]);
  const rows = summary.tasks.map((t) => line([t.taskType, t.status, t.model, String(t.inputTokens), String(t.outputTokens), `$${t.costUsd.toFixed(4)}`, `${(t.durationMs / 1000).toFixed(1)} s`, t.evidenceKind ?? "none"]));
  return [head, ...rows, `total (every run of the company): $${summary.totalCostUsd.toFixed(4)}`].join("\n");
}

/** `smoke LLM: OK ($0.12)`. */
export function okLine(totalCostUsd: number): string {
  return `smoke LLM: OK ($${totalCostUsd.toFixed(2)})`;
}
