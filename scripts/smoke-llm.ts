/**
 * TST-2: the real-Claude smoke, run on every pull request (CI job `llm-smoke`)
 * and by `pnpm validate` when a key and the SDK runtime are present. It reads
 * the worker's `/health` first and refuses anything but a staging, sandbox
 * worker on the `smoke` profile (smoke-llm-health.ts), then creates a user and
 * a company, dispatches through `task/dispatch` one `market_report` (its
 * instructions cap web searches at 3) and one `build_site`, declines the
 * go-live card the build opens (the preview stays its evidence), polls the
 * tasks until both are `done` or `failed` within `SMOKE_LLM_TIMEOUT_MS`
 * (default 420 s) and asserts: both done with verified evidence; the market
 * report is a `market_report` artifact with at least three `##` headings; the
 * build's `deploy.preview` ran and its URL answers 200; the company's
 * `agent_runs.cost_usd` sum is at most $0.50; the worker reports the `smoke`
 * profile and the runtime under test. It writes `smoke-llm.json`
 * (`{ sha, profile, tasks, totalCostUsd }`) to `docs/evidence/M7/` or to
 * `SMOKE_LLM_OUT`, then prints the per-task table and `smoke LLM: OK ($x.xx)`;
 * any failure exits 1 with every failing assertion and the table.
 *
 * Economics: the role YAML's `max_turns` and `max_budget_usd` stay. The hard
 * stop is the worker's gateway, `NORTH_DAILY_CAP_USD=0.50` per UTC day, which
 * for one CI process is a per-run cap; the gate refuses a worker without that
 * cap (or above it) on the SDK runtime. When the cap is reached the gateway
 * answers 402 and the agent run fails: the task shows up here as `failed`,
 * and its last error, printed with the verdict, carries what the run
 * reported (the gateway's 402 reason).
 *
 * Keys: this script reads no model key and prints none. The worker holds
 * `ANTHROPIC_API_KEY` (in CI from the `ANTHROPIC_TEST_API_KEY` secret, which
 * the founder adds); without it the SDK runtime does not start and the job is
 * skipped. `--runtime mock` runs the same orchestration on the mock runtime
 * (no key, no spend) to prove the plumbing.
 *
 * Usage: pnpm smoke:llm [-- [--dry-run] [--runtime mock|claude-agent-sdk]]   (CI and validate pass --runtime claude-agent-sdk)
 *   (requires the stack and `pnpm dev`; worker env: AGENT_RUNTIME, NORTH_ENV=staging,
 *   NORTH_MODEL_PROFILE=smoke, NORTH_DAILY_CAP_USD=0.50, ANTHROPIC_API_KEY)
 *   env: SMOKE_LLM_TIMEOUT_MS, SMOKE_LLM_OUT, NORTH_WORKER_URL, INNGEST_BASE_URL, GITHUB_SHA
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Inngest } from "inngest";
import { EVENT } from "@north/core";
import {
  answerCard,
  createCompany,
  createGoal,
  createServiceClient,
  createTask,
  getArtifact,
  getArtifactMarkdown,
  getTask,
  headActionsForTask,
  listPendingCardsForTask,
  listRecentRuns,
  setOnboardingStep,
  upsertBudgets,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import { localSupabaseEnv } from "../packages/db/test/env";
import { checkHealth, gatewaySpendLine } from "./smoke-llm-health";
import { buildReport, formatTable, okLine, planFor, smokeProblems, summariseRuns, type SmokeFacts, type SmokePlan, type SmokeRuntime, type SmokeSummary } from "./smoke-llm-helpers";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLL_MS = 3000;
const FETCH_TIMEOUT_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  readonly plan: SmokePlan;
  readonly db: DbClient;
  readonly inngest: Inngest;
  readonly companyId: string;
}

/** The worker's `/health` body, parsed as JSON; throws when the worker does not answer. */
async function readHealth(workerUrl: string): Promise<unknown> {
  const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  return res.json();
}

/** Prints the plan and, when the worker answers, the health gate's verdict; creates and dispatches nothing. */
async function dryRun(plan: SmokePlan): Promise<number> {
  console.log(`smoke LLM dry run (nothing created, nothing dispatched):\n${JSON.stringify(plan, null, 2)}`);
  const body = await readHealth(plan.workerUrl).catch(() => undefined);
  if (body === undefined) {
    console.log(`worker ${plan.workerUrl}/health does not answer: the health gate was not checked`);
    return 0;
  }
  const verdict = checkHealth(body, plan);
  console.log(verdict.ok ? `health gate: OK (runtime ${verdict.runtime}, profile ${verdict.profile})` : `health gate: FAIL\n- ${verdict.problems.join("\n- ")}`);
  return verdict.ok ? 0 : 1;
}

/** A fresh owner and company with a goal and budgets, onboarding marked done (no `company/onboarded`: nothing else runs). */
async function setUp(db: DbClient): Promise<{ readonly ownerId: string; readonly companyId: string }> {
  const stamp = Date.now().toString(36);
  const user = await db.auth.admin.createUser({ email: `smoke-llm-${stamp}@north.test`, password: `pw-${stamp}-Aa1!`, email_confirm: true });
  if (!user.data.user) throw new Error(`createUser failed: ${user.error?.message}`);
  const company = await createCompany(db, {
    ownerId: user.data.user.id,
    name: `Smoke Ledger ${stamp}`,
    thesis: "Bookkeeping for solo consultants that closes the month in one click.",
    targetCustomer: "Solo consultants billing 5-20 clients",
    whyNow: "Card feeds and invoicing APIs are now open enough to reconcile a month without a bookkeeper.",
  });
  await createGoal(db, company.id, { metricKey: "signups", targetValue: 50, dueDate: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) });
  await upsertBudgets(db, company.id, [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20 }]);
  await setOnboardingStep(db, company.id, "done");
  console.log(`company ${company.slug} (${company.id})`);
  return { ownerId: user.data.user.id, companyId: company.id };
}

/** Creates the plan's tasks and sends one `task/dispatch` per task; returns them in the plan's order. */
async function dispatch(ctx: Ctx): Promise<readonly TaskRecord[]> {
  const tasks = await Promise.all(
    ctx.plan.tasks.map((t) => createTask(ctx.db, { companyId: ctx.companyId, role: t.role, taskType: t.taskType, title: t.title, input: t.input, metricKey: t.metricKey, expectedDelta: t.expectedDelta })),
  );
  await ctx.inngest.send(tasks.map((t) => ({ name: EVENT.taskDispatch, data: { companyId: ctx.companyId, taskId: t.id } })));
  console.log(`dispatched ${tasks.map((t) => `${t.taskType} ${t.id}`).join(", ")}`);
  return tasks;
}

/** Declines the build's go-live card once it is open (the preview stays the evidence); true once answered. */
async function declineGoLive(ctx: Ctx, buildId: string): Promise<boolean> {
  const card = (await listPendingCardsForTask(ctx.db, buildId)).find((c) => c.actionKind === "deploy.production");
  if (!card) return false;
  if (!card.options.some((o) => o.id === "decline")) throw new Error(`the go-live card ${card.id} has no "decline" option`);
  await answerCard(ctx.db, card.id, { optionId: "decline", answeredBy: "user" });
  await ctx.inngest.send({ name: EVENT.decisionAnswered, data: { companyId: ctx.companyId, cardId: card.id, optionId: "decline", answeredBy: "user" } });
  console.log(`go-live card ${card.id} declined: the preview stays the build's evidence`);
  return true;
}

const isSettled = (t: TaskRecord): boolean => t.status === "done" || t.status === "failed";

async function reload(db: DbClient, tasks: readonly TaskRecord[]): Promise<readonly TaskRecord[]> {
  return Promise.all(tasks.map(async (t) => (await getTask(db, t.id)) ?? t));
}

/** Polls until every task is done or failed, or the plan's timeout; answers the go-live card on the way. */
async function settle(ctx: Ctx, dispatched: readonly TaskRecord[]): Promise<readonly TaskRecord[]> {
  const started = Date.now();
  const build = dispatched.find((t) => t.taskType === "build_site");
  let declined = build === undefined;
  let tasks = dispatched;
  let last = "";
  while (!tasks.every(isSettled) && Date.now() - started < ctx.plan.timeoutMs) {
    await sleep(POLL_MS);
    if (!declined && build) declined = await declineGoLive(ctx, build.id);
    tasks = await reload(ctx.db, tasks);
    const now = tasks.map((t) => `${t.taskType} ${t.status}`).join(", ");
    if (now !== last) console.log(`t+${Math.round((Date.now() - started) / 1000)}s ${now}`);
    last = now;
  }
  return tasks;
}

async function readMarketReport(db: DbClient, task: TaskRecord | undefined): Promise<SmokeFacts["marketReport"]> {
  if (task?.evidence?.kind !== "artifact_id") return null;
  const artifact = await getArtifact(db, task.evidence.ref);
  const markdown = artifact ? await getArtifactMarkdown(db, artifact.id) : null;
  return artifact && markdown !== null ? { kind: artifact.kind, markdown } : null;
}

async function readPreview(db: DbClient, task: TaskRecord | undefined): Promise<SmokeFacts["preview"]> {
  const action = task ? (await headActionsForTask(db, task.id)).find((a) => a.kind === "deploy.preview") : undefined;
  if (!action) return { status: null, url: null, httpStatus: null };
  const url = action.externalRef?.startsWith("http") ? action.externalRef : null;
  const httpStatus = url ? await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((r) => r.status, () => null) : null;
  return { status: action.status, url, httpStatus };
}

/** What the verdict reads: the tasks' outcomes, the company's runs, the market report and the preview. */
async function gatherFacts(ctx: Ctx, tasks: readonly TaskRecord[], runtime: SmokeRuntime): Promise<SmokeFacts> {
  const runs = await listRecentRuns(ctx.db, ctx.companyId, 1000);
  const summary = summariseRuns(
    runs.map((r) => ({ taskId: r.taskId, model: r.model, runtime: r.runtime, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, durationMs: r.durationMs })),
    tasks.map((t) => ({ id: t.id, taskType: t.taskType, status: t.status, evidenceKind: t.evidence?.kind ?? null })),
  );
  return {
    runtime,
    maxCostUsd: ctx.plan.maxCostUsd,
    tasks: tasks.map((t) => ({ taskType: t.taskType, status: t.status, evidence: t.evidence ? { kind: t.evidence.kind, verified: t.evidence.verified } : null, lastError: t.lastError })),
    summary,
    marketReport: await readMarketReport(ctx.db, tasks.find((t) => t.taskType === "market_report")),
    preview: await readPreview(ctx.db, tasks.find((t) => t.taskType === "build_site")),
  };
}

function commitSha(plan: SmokePlan): string {
  if (plan.sha) return plan.sha;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Writes `smoke-llm.json` (also on a failed run: the evidence of what happened); returns its path. */
async function writeEvidence(plan: SmokePlan, profile: string, summary: SmokeSummary): Promise<string> {
  const path = resolve(REPO_ROOT, plan.outPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(buildReport({ sha: commitSha(plan), profile, summary }), null, 2)}\n`);
  return path;
}

/** The gateway's spend today as the worker reports it, for the log; null without a gateway or an answer. */
async function gatewaySpend(workerUrl: string): Promise<string | null> {
  return gatewaySpendLine(await readHealth(workerUrl).catch(() => null));
}

/** One full run against a worker that passed the gate; returns the exit code. */
async function run(plan: SmokePlan, runtime: SmokeRuntime, profile: string): Promise<number> {
  const env = localSupabaseEnv();
  const db = createServiceClient({ url: env.url, serviceRoleKey: env.serviceRoleKey });
  const { ownerId, companyId } = await setUp(db);
  const ctx: Ctx = { plan, db, inngest: new Inngest({ id: "north-smoke-llm", isDev: true, baseUrl: plan.inngestUrl }), companyId };
  const tasks = await settle(ctx, await dispatch(ctx));
  const facts = await gatherFacts(ctx, tasks, runtime);
  const timedOut = tasks.every(isSettled) ? [] : [`timed out after ${Math.round(plan.timeoutMs / 1000)} s waiting for both tasks to be done or failed`];
  const problems = [...timedOut, ...smokeProblems(facts)];
  console.log(`\n${formatTable(facts.summary)}`);
  console.log(`evidence: ${await writeEvidence(plan, profile, facts.summary)}`);
  const spend = await gatewaySpend(plan.workerUrl);
  if (spend) console.log(spend);
  if (problems.length > 0) {
    console.error(`\nsmoke LLM: FAIL (company ${companyId} kept for inspection)\n- ${problems.join("\n- ")}`);
    return 1;
  }
  await db.auth.admin.deleteUser(ownerId);
  console.log(okLine(facts.summary.totalCostUsd));
  return 0;
}

async function main(): Promise<number> {
  const plan = planFor(process.env, process.argv.slice(2));
  if (plan.dryRun) return dryRun(plan);
  const body = await readHealth(plan.workerUrl).catch((error: unknown) => {
    throw new Error(`the worker does not answer at ${plan.workerUrl}/health (${error instanceof Error ? error.message : String(error)}): run 'pnpm dev'`);
  });
  const verdict = checkHealth(body, plan);
  if (!verdict.ok || verdict.runtime === null || verdict.profile === null) {
    console.error(`smoke LLM: FAIL (health gate, nothing created)\n- ${verdict.problems.join("\n- ")}`);
    return 1;
  }
  console.log(`smoke LLM on runtime ${verdict.runtime}, profile ${verdict.profile}, cap $${plan.maxCostUsd.toFixed(2)}, timeout ${plan.timeoutMs / 1000} s`);
  return run(plan, verdict.runtime, verdict.profile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`smoke LLM: FAIL\n- ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
