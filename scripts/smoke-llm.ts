/**
 * TST-2: the real-Claude smoke, run on every pull request (CI job `llm-smoke`)
 * and by `pnpm validate` when the worker is on the SDK runtime and a key is
 * set. It reads the worker's `/health` first and refuses anything but a
 * staging, sandbox worker on the `smoke` profile (smoke-llm-health.ts), and a
 * database that is not this machine unless `SMOKE_LLM_ALLOW_REMOTE_DB=1`. Then
 * it creates a user and a company, dispatches through `task/dispatch` one
 * `market_report` (its instructions cap web searches at 3) and one
 * `build_site`, declines the go-live card the build opens (the preview stays
 * its evidence), polls the tasks until both are `done` or `failed` within
 * `SMOKE_LLM_TIMEOUT_MS` (default 420 s) and asserts (smoke-llm-verdict.ts):
 * both done with verified evidence; the market report is a `market_report`
 * artifact with at least three `##` headings; the build's `deploy.preview` ran
 * and its URL answers 200; the company's `agent_runs.cost_usd` sum (the
 * ledger) is at most $0.50; on the SDK runtime every smoke task ran on it with
 * tokens, and the gateway priced more than $0 and at most $0.50 during the run
 * (its `/health` `budget.spentUsd` at the gate and after: the spend truth, as
 * a run can store `cost_usd` 0), with no $0 ledger next to used tokens. It
 * writes `{ sha, profile, runtime, gateway, tasks, totalCostUsd, gatewaySpentUsd }`
 * (`gateway`: the mode the worker's `/health` reports) to `SMOKE_LLM_OUT`, else
 * `docs/evidence/M7/smoke-llm.json` on the SDK runtime, `smoke-llm.mock.json` on
 * the mock and `smoke-llm.replay.json` against a replaying gateway (neither
 * ever writes the proof path), prints the per-task table and
 * `smoke LLM: OK (ledger $x.xx, gateway $y.yy), runtime …`. Any failure, an
 * exception after dispatch included, exits 1 with every problem and the
 * table, and presses the company's kill switch so a local run spends nothing
 * more.
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
 * the founder adds); without the secret the CI job skips every step.
 * `--runtime mock` runs the same orchestration on the mock runtime (no key,
 * no spend, no gateway) to prove the plumbing.
 *
 * Usage: pnpm smoke:llm [-- [--dry-run] [--runtime mock|claude-agent-sdk]]   (CI and validate pass --runtime claude-agent-sdk)
 *   (requires the stack and `pnpm dev`; worker env: AGENT_RUNTIME, NORTH_ENV=staging,
 *   NORTH_MODEL_PROFILE=smoke, NORTH_DAILY_CAP_USD=0.50, ANTHROPIC_API_KEY)
 *   env: SMOKE_LLM_TIMEOUT_MS, SMOKE_LLM_OUT, SMOKE_LLM_SHA (else GITHUB_SHA, else git),
 *   SMOKE_LLM_ALLOW_REMOTE_DB=1 (a non-loopback SUPABASE_URL), NORTH_WORKER_URL, INNGEST_BASE_URL
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
  setKillSwitch,
  setOnboardingStep,
  upsertBudgets,
  type AgentRunRecord,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import { localSupabaseEnv } from "../packages/db/test/env";
import { purgeSmokeUser } from "./lib/purge-smoke-user";
import { checkHealth, spentUsdOf } from "./smoke-llm-health";
import { attempt, buildReport, databaseRefusal, evidencePathFor, formatTable, messageOf, okLine, pickPreview, planFor, summariseRuns, type SmokeGateway, type SmokePlan, type SmokeRuntime, type SmokeSummary } from "./smoke-llm-helpers";
import { gatewayDeltaUsd, smokeProblems, type SmokeFacts } from "./smoke-llm-verdict";

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

const NO_PREVIEW: SmokeFacts["preview"] = { status: null, url: null, httpStatus: null };

/** The build's preview (the one its evidence names, else the newest) and what its URL answers. */
async function readPreview(db: DbClient, task: TaskRecord | undefined): Promise<SmokeFacts["preview"]> {
  if (!task) return NO_PREVIEW;
  const action = pickPreview(await headActionsForTask(db, task.id), task.evidence?.kind === "url" ? task.evidence.ref : null);
  if (!action) return NO_PREVIEW;
  const url = action.externalRef?.startsWith("http") ? action.externalRef : null;
  const httpStatus = url ? await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((r) => r.status, () => null) : null;
  return { status: action.status, url, httpStatus };
}

/** What the gate found: the runtime under test, the worker's profile, the gateway's day spend before anything was created and its mode. */
interface Gate {
  readonly runtime: SmokeRuntime;
  readonly profile: string;
  readonly spentUsd: number | null;
  readonly gateway: SmokeGateway | null;
}

/** What the verdict reads: the tasks' outcomes, the company's runs, the market report, the preview and the gateway's spend; a read that throws becomes a problem. */
async function gatherFacts(ctx: Ctx, tasks: readonly TaskRecord[], gate: Gate): Promise<{ readonly facts: SmokeFacts; readonly problems: readonly string[] }> {
  const runs = await attempt<readonly AgentRunRecord[]>("reading agent_runs", () => listRecentRuns(ctx.db, ctx.companyId, 1000), () => []);
  const report = await attempt("reading the market report", () => readMarketReport(ctx.db, tasks.find((t) => t.taskType === "market_report")), () => null);
  const preview = await attempt("reading the preview", () => readPreview(ctx.db, tasks.find((t) => t.taskType === "build_site")), () => NO_PREVIEW);
  const gateway = gate.runtime === "claude-agent-sdk" ? { beforeUsd: gate.spentUsd, afterUsd: spentUsdOf(await readHealth(ctx.plan.workerUrl).catch(() => null)) } : null;
  const summary = summariseRuns(
    runs.value.map((r) => ({ taskId: r.taskId, model: r.model, runtime: r.runtime, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, durationMs: r.durationMs })),
    tasks.map((t) => ({ id: t.id, taskType: t.taskType, status: t.status, evidenceKind: t.evidence?.kind ?? null })),
  );
  const facts: SmokeFacts = {
    runtime: gate.runtime,
    maxCostUsd: ctx.plan.maxCostUsd,
    tasks: tasks.map((t) => ({ taskType: t.taskType, status: t.status, evidence: t.evidence ? { kind: t.evidence.kind, verified: t.evidence.verified } : null, lastError: t.lastError })),
    summary,
    marketReport: report.value,
    preview: preview.value,
    gateway,
  };
  return { facts, problems: [runs.problem, report.problem, preview.problem].filter((p): p is string => p !== null) };
}

function commitSha(plan: SmokePlan): string {
  if (plan.sha) return plan.sha;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Writes the evidence file (also on a failed run: the evidence of what happened); a mock run and a replaying gateway never write the proof path. Returns its path. */
async function writeEvidence(plan: SmokePlan, gate: Gate, summary: SmokeSummary, gatewaySpentUsd: number | null): Promise<string> {
  const path = resolve(REPO_ROOT, evidencePathFor(plan.outPath, gate.runtime, gate.gateway));
  const report = buildReport({ sha: commitSha(plan), profile: gate.profile, runtime: gate.runtime, gateway: gate.gateway, summary, gatewaySpentUsd });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/** Presses the company's kill switch the way the web does (`setKillSwitch` + `company/killswitch`), so a failed or timed-out run spends nothing more. */
async function stopCompany(ctx: Ctx): Promise<string> {
  try {
    await setKillSwitch(ctx.db, ctx.companyId, true);
    await ctx.inngest.send({ name: EVENT.companyKillSwitch, data: { companyId: ctx.companyId } });
    return `kill switch pressed for company ${ctx.companyId}: its agents stop and spend nothing more (the company is kept for inspection)`;
  } catch (error) {
    return `could not press the kill switch for company ${ctx.companyId} (${messageOf(error)}): stop the worker to stop its spend`;
  }
}

/** One full run against a worker that passed the gate; returns the exit code. */
async function run(plan: SmokePlan, gate: Gate): Promise<number> {
  const env = localSupabaseEnv();
  const refusal = databaseRefusal(env.url, plan.allowRemoteDb);
  if (refusal) throw new Error(`${refusal} (nothing created)`);
  const db = createServiceClient({ url: env.url, serviceRoleKey: env.serviceRoleKey });
  const { ownerId, companyId } = await setUp(db);
  const ctx: Ctx = { plan, db, inngest: new Inngest({ id: "north-smoke-llm", isDev: true, baseUrl: plan.inngestUrl }), companyId };
  const dispatched = await dispatch(ctx);
  const settled = await attempt("waiting for the tasks", () => settle(ctx, dispatched), () => reload(ctx.db, dispatched).catch(() => dispatched));
  const { facts, problems: readProblems } = await gatherFacts(ctx, settled.value, gate);
  const timedOut = settled.value.every(isSettled) ? [] : [`timed out after ${Math.round(plan.timeoutMs / 1000)} s waiting for both tasks to be done or failed`];
  const problems = [...(settled.problem ? [settled.problem] : []), ...readProblems, ...timedOut, ...smokeProblems(facts)];
  const gatewayUsd = gatewayDeltaUsd(facts.gateway);
  console.log(`\n${formatTable(facts.summary, { runtime: gate.runtime, gatewayUsd })}`);
  console.log(`evidence: ${await writeEvidence(plan, gate, facts.summary, gatewayUsd)}`);
  if (problems.length > 0) {
    console.error(`\nsmoke LLM: FAIL\n- ${problems.join("\n- ")}\n${await stopCompany(ctx)}`);
    return 1;
  }
  await purgeSmokeUser(db, ownerId);
  console.log(okLine({ runtime: gate.runtime, ledgerUsd: facts.summary.totalCostUsd, gatewayUsd }));
  return 0;
}

async function main(): Promise<number> {
  const plan = planFor(process.env, process.argv.slice(2));
  if (plan.dryRun) return dryRun(plan);
  const body = await readHealth(plan.workerUrl).catch((error: unknown) => {
    throw new Error(`the worker does not answer at ${plan.workerUrl}/health (${messageOf(error)}): run 'pnpm dev'`);
  });
  const verdict = checkHealth(body, plan);
  if (!verdict.ok || verdict.runtime === null || verdict.profile === null) {
    console.error(`smoke LLM: FAIL (health gate, nothing created)\n- ${verdict.problems.join("\n- ")}`);
    return 1;
  }
  const gatewayNow = verdict.spentUsd === null ? "" : `, gateway spent $${verdict.spentUsd.toFixed(4)} today so far`;
  console.log(`smoke LLM on runtime ${verdict.runtime}, profile ${verdict.profile}, cap $${plan.maxCostUsd.toFixed(2)}, timeout ${plan.timeoutMs / 1000} s${gatewayNow}`);
  return run(plan, { runtime: verdict.runtime, profile: verdict.profile, spentUsd: verdict.spentUsd, gateway: verdict.gateway });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`smoke LLM: FAIL\n- ${messageOf(error)}`);
      process.exitCode = 1;
    },
  );
}
