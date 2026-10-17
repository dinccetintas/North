/** TST-2: the pure parts of the real-Claude smoke (`smoke-llm.ts`): the plan, the markdown check, the run summary, the gates, the verdict and the evidence; no stack, no network, no key. */
import { describe, expect, it } from "vitest";
import { checkHealth, spentUsdOf } from "./smoke-llm-health";
import {
  assertMarkdownHeadings,
  attempt,
  buildReport,
  databaseRefusal,
  evidencePathFor,
  formatTable,
  okLine,
  pickPreview,
  planFor,
  summariseRuns,
  type SmokeRun,
  type SmokeTaskState,
} from "./smoke-llm-helpers";
import { gatewayDeltaUsd, smokeProblems, type SmokeFacts } from "./smoke-llm-verdict";

const REPORT = ["# Market report: Acme", "", "## 1. Market definition", "text", "## 2. Size", "text", "### 2.1 detail", "## 3. Demand", "text"].join("\n");

describe("TST-2 assertMarkdownHeadings", () => {
  it("passes with three `##` headings and returns the count", () => {
    expect(assertMarkdownHeadings(REPORT, 3)).toBe(3);
  });

  it("fails with two, and the message names the count and the minimum", () => {
    const two = ["## One", "x", "## Two", "y"].join("\n");
    expect(() => assertMarkdownHeadings(two, 3)).toThrow(/2 `##` headings.*at least 3/);
  });

  it("a `#` top-level heading, a `###` heading and a `##` without text do not count", () => {
    const text = ["# Title", "### Deeper", "##", "##no-space", "## Real one", "  ## indented two spaces"].join("\n");
    expect(() => assertMarkdownHeadings(text, 3)).toThrow(/2 `##` headings/);
  });

  it("headings inside backtick or tilde code fences do not count, and a fence closes only on its own marker", () => {
    const fenced = ["## Outside", "```md", "## inside backticks", "~~~", "## still inside: a tilde line does not close a backtick fence", "```", "~~~~", "## inside tildes", "~~~~", "## Outside again"].join("\n");
    expect(() => assertMarkdownHeadings(fenced, 3)).toThrow(/2 `##` headings/);
    expect(assertMarkdownHeadings(`${fenced}\n## Third`, 3)).toBe(3);
  });

  it("an unclosed fence hides everything after it", () => {
    expect(() => assertMarkdownHeadings(["## A", "## B", "```", "## C", "## D"].join("\n"), 3)).toThrow(/2 `##` headings/);
  });

  it("an empty report fails naming zero", () => {
    expect(() => assertMarkdownHeadings("", 3)).toThrow(/0 `##` headings/);
  });
});

const MARKET = "11111111-1111-4111-8111-111111111111";
const BUILD = "22222222-2222-4222-8222-222222222222";
const tasks: readonly SmokeTaskState[] = [
  { id: MARKET, taskType: "market_report", status: "done", evidenceKind: "artifact_id" },
  { id: BUILD, taskType: "build_site", status: "done", evidenceKind: "url" },
];
const run = (taskId: string | null, model: string, costUsd: number, durationMs: number, tokens = 1000): SmokeRun => ({ taskId, model, runtime: "claude-agent-sdk", inputTokens: tokens, outputTokens: tokens / 10, costUsd, durationMs });

describe("TST-2 summariseRuns", () => {
  it("one row per smoke task, in the tasks' order, with its runs' tokens, cost and duration summed", () => {
    const summary = summariseRuns([run(BUILD, "claude-haiku-5-5", 0.1, 60_000, 3000), run(MARKET, "claude-haiku-5-5", 0.05, 20_000), run(BUILD, "claude-haiku-5-5", 0.02, 5_000, 500)], tasks);
    expect(summary.tasks).toEqual([
      { taskType: "market_report", status: "done", model: "claude-haiku-5-5", inputTokens: 1000, outputTokens: 100, costUsd: 0.05, durationMs: 20_000, evidenceKind: "artifact_id" },
      { taskType: "build_site", status: "done", model: "claude-haiku-5-5", inputTokens: 3500, outputTokens: 350, costUsd: 0.12, durationMs: 65_000, evidenceKind: "url" },
    ]);
  });

  it("the total is every run of the company, a run without a task or of another task included, without float noise", () => {
    const summary = summariseRuns([run(MARKET, "a", 0.1, 1), run(BUILD, "a", 0.2, 1), run(null, "a", 0.0001, 1), run("33333333-3333-4333-8333-333333333333", "a", 0.05, 1)], tasks);
    expect(summary.totalCostUsd).toBe(0.3501);
  });

  it("names every model a task's runs used, first seen first, and `none` for a task with no run", () => {
    const summary = summariseRuns([run(MARKET, "claude-haiku-5-5", 0, 1), run(MARKET, "claude-sonnet-5-5", 0, 1), run(MARKET, "claude-haiku-5-5", 0, 1)], tasks);
    expect(summary.tasks[0]?.model).toBe("claude-haiku-5-5, claude-sonnet-5-5");
    expect(summary.tasks[1]).toMatchObject({ model: "none", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 });
  });

  it("lists the runtimes the smoke tasks' runs ran on, and does not change its inputs", () => {
    const runs = Object.freeze([run(MARKET, "mock", 0, 1), { ...run(BUILD, "mock", 0, 1), runtime: "mock" }]);
    const summary = summariseRuns(runs, Object.freeze([...tasks]));
    expect(summary.runtimes).toEqual(["claude-agent-sdk", "mock"]);
    expect(Object.isFrozen(summary.tasks)).toBe(true);
  });
});

describe("TST-2 planFor", () => {
  it("defaults: 420 s, the evidence path by runtime, the local worker and Inngest, $0.50, the two smoke tasks, runtime from /health", () => {
    const plan = planFor({});
    expect(plan).toMatchObject({ dryRun: false, runtime: null, timeoutMs: 420_000, outPath: null, workerUrl: "http://localhost:3101", inngestUrl: "http://localhost:8288", maxCostUsd: 0.5, sha: null, allowRemoteDb: false });
    expect(plan.tasks.map((t) => [t.role, t.taskType])).toEqual([
      ["research", "market_report"],
      ["engineering", "build_site"],
    ]);
    expect(plan.tasks[0]?.input).toMatch(/at most 3 web searches/);
  });

  it("reads SMOKE_LLM_TIMEOUT_MS, SMOKE_LLM_OUT, NORTH_WORKER_URL, INNGEST_BASE_URL and the sha; a blank value is unset", () => {
    const plan = planFor({ SMOKE_LLM_TIMEOUT_MS: "90000", SMOKE_LLM_OUT: "/tmp/run/smoke-llm.json", NORTH_WORKER_URL: "http://127.0.0.1:3101/", INNGEST_BASE_URL: "http://127.0.0.1:8288", GITHUB_SHA: "c074558" });
    expect(plan).toMatchObject({ timeoutMs: 90_000, outPath: "/tmp/run/smoke-llm.json", workerUrl: "http://127.0.0.1:3101", inngestUrl: "http://127.0.0.1:8288", sha: "c074558" });
    expect(planFor({ SMOKE_LLM_TIMEOUT_MS: " ", SMOKE_LLM_OUT: "" })).toMatchObject({ timeoutMs: 420_000, outPath: null });
  });

  it("SMOKE_LLM_SHA (the pull request's head in CI) wins over GITHUB_SHA (the merge commit)", () => {
    expect(planFor({ SMOKE_LLM_SHA: "ccb8c9e9", GITHUB_SHA: "c074558" }).sha).toBe("ccb8c9e9");
    expect(planFor({ SMOKE_LLM_SHA: " ", GITHUB_SHA: "c074558" }).sha).toBe("c074558");
    expect(() => planFor({ SMOKE_LLM_SHA: "not a sha" })).toThrow(/SMOKE_LLM_SHA/);
  });

  it("a timeout that is not a positive whole number of milliseconds is a usage error naming the variable", () => {
    for (const value of ["abc", "0", "-5", "1.5"]) expect(() => planFor({ SMOKE_LLM_TIMEOUT_MS: value })).toThrow(/SMOKE_LLM_TIMEOUT_MS/);
  });

  it("flags: --dry-run, --runtime mock|claude-agent-sdk (either spelling), a lone `--` is dropped; anything else is a usage error", () => {
    expect(planFor({}, ["--", "--dry-run", "--runtime", "mock"])).toMatchObject({ dryRun: true, runtime: "mock" });
    expect(planFor({}, ["--runtime=claude-agent-sdk"]).runtime).toBe("claude-agent-sdk");
    expect(() => planFor({}, ["--runtime", "gpt"])).toThrow(/--runtime/);
    expect(() => planFor({}, ["--budget", "5"])).toThrow();
    expect(() => planFor({}, ["extra"])).toThrow();
  });

  it("refuses an environment that names production or live integrations", () => {
    expect(() => planFor({ NORTH_ENV: "production" })).toThrow(/NORTH_ENV=production/);
    expect(() => planFor({ INTEGRATIONS_MODE: "live" })).toThrow(/INTEGRATIONS_MODE=live/);
    expect(planFor({ NORTH_ENV: "staging", INTEGRATIONS_MODE: "sandbox" }).dryRun).toBe(false);
  });

  it("refuses a remote database in the environment unless SMOKE_LLM_ALLOW_REMOTE_DB=1", () => {
    expect(() => planFor({ SUPABASE_URL: "https://abcd.supabase.co" })).toThrow(/abcd\.supabase\.co.*SMOKE_LLM_ALLOW_REMOTE_DB=1/);
    expect(() => planFor({ NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" })).toThrow(/SMOKE_LLM_ALLOW_REMOTE_DB/);
    expect(planFor({ SUPABASE_URL: "https://abcd.supabase.co", SMOKE_LLM_ALLOW_REMOTE_DB: "1" }).allowRemoteDb).toBe(true);
    expect(planFor({ SUPABASE_URL: "http://127.0.0.1:54321" }).allowRemoteDb).toBe(false);
    expect(() => planFor({ SMOKE_LLM_ALLOW_REMOTE_DB: "yes" })).toThrow(/SMOKE_LLM_ALLOW_REMOTE_DB/);
  });

  it("never carries the model key, whatever the environment holds", () => {
    const key = "fake-model-key-not-real-0123456789";
    const plan = planFor({ ANTHROPIC_API_KEY: key, ANTHROPIC_TEST_API_KEY: key });
    expect(JSON.stringify(plan)).not.toContain(key);
  });
});

describe("TST-2 database and evidence targets", () => {
  it("a loopback database passes; any other host is refused unless allowed, and a malformed URL is refused", () => {
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321/", "http://[::1]:54321"]) expect(databaseRefusal(url, false)).toBeNull();
    expect(databaseRefusal("https://abcd.supabase.co", false)).toMatch(/abcd\.supabase\.co.*SMOKE_LLM_ALLOW_REMOTE_DB=1/);
    expect(databaseRefusal("http://10.0.0.5:54321", false)).toMatch(/10\.0\.0\.5/);
    expect(databaseRefusal("https://abcd.supabase.co", true)).toBeNull();
    expect(databaseRefusal("not a url", true)).toMatch(/not a URL/);
  });

  it("a mock run never writes the proof path: its default is smoke-llm.mock.json; SMOKE_LLM_OUT wins for both", () => {
    expect(evidencePathFor(null, "claude-agent-sdk", "record")).toBe("docs/evidence/M7/smoke-llm.json");
    expect(evidencePathFor(null, "mock", null)).toBe("docs/evidence/M7/smoke-llm.mock.json");
    expect(evidencePathFor("/tmp/out.json", "mock", null)).toBe("/tmp/out.json");
  });

  it("a replaying gateway never writes the proof path either: tape is not real Claude. Live and record do", () => {
    expect(evidencePathFor(null, "claude-agent-sdk", "replay")).toBe("docs/evidence/M7/smoke-llm.replay.json");
    expect(evidencePathFor(null, "claude-agent-sdk", "live")).toBe("docs/evidence/M7/smoke-llm.json");
    expect(evidencePathFor(null, "claude-agent-sdk", "record")).toBe("docs/evidence/M7/smoke-llm.json");
    expect(evidencePathFor("/tmp/out.json", "claude-agent-sdk", "replay")).toBe("/tmp/out.json");
  });
});

describe("TST-2 attempt (an exception after dispatch)", () => {
  it("a throw becomes a problem naming the step and the message, and the fallback's value", async () => {
    const failed = await attempt("reading the market report", () => Promise.reject(new Error("storage 503")), () => null);
    expect(failed).toEqual({ value: null, problem: "reading the market report: storage 503" });
    expect(await attempt("waiting for the tasks", () => Promise.reject("reload failed"), async () => ["as dispatched"])).toEqual({ value: ["as dispatched"], problem: "waiting for the tasks: reload failed" });
  });

  it("a step that works has no problem", async () => {
    expect(await attempt("reading agent_runs", async () => [1, 2], () => [])).toEqual({ value: [1, 2], problem: null });
  });
});

describe("TST-2 pickPreview", () => {
  const preview = (createdAt: string, externalRef: string | null, status = "notified") => ({ kind: "deploy.preview", status, externalRef, createdAt });
  const older = preview("2026-10-17T10:00:00Z", "http://localhost:3101/sandbox/sites/a-v1/");
  const newer = preview("2026-10-17T10:05:00Z", "http://localhost:3101/sandbox/sites/a-v2/");
  const push = { kind: "repo.push", status: "notified", externalRef: "http://x/", createdAt: "2026-10-17T10:06:00Z" };

  it("takes the preview whose URL is the build's evidence", () => {
    expect(pickPreview([older, newer, push], older.externalRef)).toBe(older);
  });

  it("otherwise the newest preview, whatever order the actions come in; none without a preview", () => {
    expect(pickPreview([newer, older, push], null)).toBe(newer);
    expect(pickPreview([older, newer], "http://elsewhere/")).toBe(newer);
    expect(pickPreview([push], null)).toBeNull();
  });
});

const sdkHealth = { ok: true, app: "north-worker", mode: "sandbox", runtime: "claude-agent-sdk", profile: "smoke", env: "staging", gateway: "record", budget: { capUsd: 0.5, spentUsd: 0.04, unpriced: 0, exhausted: false } };
const mockHealth = { ...sdkHealth, runtime: "mock", gateway: "off", budget: null };
const gate = { runtime: null, maxCostUsd: 0.5 } as const;

describe("TST-2 health gate", () => {
  it("a staging sandbox worker on the smoke profile with a $0.50 gateway cap passes; the runtime under test comes from /health; the gateway's spend so far is kept", () => {
    expect(checkHealth(sdkHealth, gate)).toEqual({ ok: true, runtime: "claude-agent-sdk", profile: "smoke", spentUsd: 0.04, gateway: "record", problems: [] });
    expect(checkHealth(mockHealth, gate)).toEqual({ ok: true, runtime: "mock", profile: "smoke", spentUsd: null, gateway: null, problems: [] });
  });

  it("the gateway's mode comes from /health: live, record or replay; off (no gateway) or anything else is null", () => {
    for (const mode of ["live", "record", "replay"] as const) expect(checkHealth({ ...sdkHealth, gateway: mode }, gate).gateway).toBe(mode);
    expect(checkHealth({ ...sdkHealth, gateway: "off" }, gate).gateway).toBeNull();
    expect(checkHealth({ ...sdkHealth, gateway: "tape" }, gate).gateway).toBeNull();
  });

  it("a profile that is not smoke fails, naming what it found and what to set", () => {
    const verdict = checkHealth({ ...sdkHealth, profile: "production" }, gate);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toEqual([expect.stringMatching(/profile is "production".*NORTH_MODEL_PROFILE=smoke/)]);
  });

  it("refuses a production worker and live integrations", () => {
    expect(checkHealth({ ...sdkHealth, env: "production" }, gate).problems).toEqual([expect.stringMatching(/env is "production".*NORTH_ENV=staging/)]);
    expect(checkHealth({ ...sdkHealth, mode: "live" }, gate).problems).toEqual([expect.stringMatching(/mode is "live".*INTEGRATIONS_MODE=sandbox/)]);
  });

  it("the runtime asked with --runtime must be the worker's", () => {
    const verdict = checkHealth(mockHealth, { runtime: "claude-agent-sdk", maxCostUsd: 0.5 });
    expect(verdict).toMatchObject({ ok: false, runtime: "claude-agent-sdk" });
    expect(verdict.problems).toEqual([expect.stringMatching(/runtime is "mock".*--runtime claude-agent-sdk/)]);
  });

  it("the SDK runtime needs the gateway's day cap on and at most $0.50, and money left today", () => {
    const capped = (budget: unknown) => checkHealth({ ...sdkHealth, budget }, gate).problems.join("\n");
    expect(capped(null)).toMatch(/NORTH_DAILY_CAP_USD/);
    expect(capped({ capUsd: 0, spentUsd: 0, unpriced: 0, exhausted: false })).toMatch(/NORTH_DAILY_CAP_USD/);
    expect(capped({ capUsd: 5, spentUsd: 0, unpriced: 0, exhausted: false })).toMatch(/capUsd is 5.*0\.5/);
    expect(capped({ capUsd: 0.5, spentUsd: 0.5, unpriced: 0, exhausted: false })).toMatch(/spent/);
    expect(capped({ capUsd: 0.5, spentUsd: 0.1, unpriced: 1, exhausted: true })).toMatch(/closed/);
  });

  it("the gateway's spend is read from a well-formed budget only", () => {
    expect(spentUsdOf(sdkHealth)).toBe(0.04);
    expect(spentUsdOf(mockHealth)).toBeNull();
    expect(spentUsdOf({ budget: { capUsd: "0.5", spentUsd: "x" } })).toBeNull();
    expect(spentUsdOf(null)).toBeNull();
  });

  it("a body that is not a worker health line, or one older than M7, fails saying so; every problem is listed at once", () => {
    expect(checkHealth("<html>", gate).problems).toEqual([expect.stringMatching(/not the worker's health line/)]);
    const older = checkHealth({ ok: true, app: "north-worker", mode: "sandbox", runtime: "mock" }, gate);
    expect(older.problems.join("\n")).toMatch(/older than this smoke/);
    expect(checkHealth({ ...sdkHealth, profile: "production", env: "production", mode: "live" }, gate).problems).toHaveLength(3);
  });
});

const goodFacts = (patch: Partial<SmokeFacts> = {}): SmokeFacts => ({
  runtime: "claude-agent-sdk",
  maxCostUsd: 0.5,
  tasks: [
    { taskType: "market_report", status: "done", evidence: { kind: "artifact_id", verified: true }, lastError: null },
    { taskType: "build_site", status: "done", evidence: { kind: "url", verified: true }, lastError: null },
  ],
  summary: summariseRuns([run(MARKET, "claude-haiku-5-5", 0.05, 1), run(BUILD, "claude-haiku-5-5", 0.2, 1)], tasks),
  marketReport: { kind: "market_report", markdown: REPORT },
  preview: { status: "notified", url: "http://localhost:3101/sandbox/sites/acme/", httpStatus: 200 },
  gateway: { beforeUsd: 0.04, afterUsd: 0.31 },
  ...patch,
});
const mockSummary = summariseRuns([{ ...run(MARKET, "mock", 0, 1), runtime: "mock" }, { ...run(BUILD, "mock", 0, 1), runtime: "mock" }], tasks);

describe("TST-2 verdict", () => {
  it("the run the brief describes has no problem", () => {
    expect(smokeProblems(goodFacts())).toEqual([]);
  });

  it("a failed task is named with its last error (a gateway 402 shows up here)", () => {
    const failed = goodFacts({ tasks: [{ taskType: "market_report", status: "failed", evidence: null, lastError: "402 north_budget_exceeded" }, goodFacts().tasks[1]!] });
    expect(smokeProblems(failed)).toEqual(expect.arrayContaining([expect.stringMatching(/market_report is failed.*402 north_budget_exceeded/)]));
  });

  it("done without verified evidence, a report with too few headings or of the wrong kind fails", () => {
    expect(smokeProblems(goodFacts({ tasks: [{ taskType: "market_report", status: "done", evidence: { kind: "artifact_id", verified: false }, lastError: null }, goodFacts().tasks[1]!] })).join("\n")).toMatch(/market_report.*verified evidence/);
    expect(smokeProblems(goodFacts({ marketReport: { kind: "market_report", markdown: "## one\n## two" } })).join("\n")).toMatch(/2 `##` headings/);
    expect(smokeProblems(goodFacts({ marketReport: { kind: "prd", markdown: REPORT } })).join("\n")).toMatch(/kind "prd"/);
    expect(smokeProblems(goodFacts({ marketReport: null })).join("\n")).toMatch(/no market report artifact/);
  });

  it("the preview must have run (K1 completes as `notified`) and answer 200", () => {
    expect(smokeProblems(goodFacts({ preview: { status: "executed", url: "http://x/", httpStatus: 200 } }))).toEqual([]);
    expect(smokeProblems(goodFacts({ preview: { status: "blocked", url: null, httpStatus: null } })).join("\n")).toMatch(/deploy.preview is blocked/);
    expect(smokeProblems(goodFacts({ preview: { status: "notified", url: "http://x/", httpStatus: 404 } })).join("\n")).toMatch(/answered 404/);
    expect(smokeProblems(goodFacts({ preview: { status: null, url: null, httpStatus: null } })).join("\n")).toMatch(/no deploy.preview action/);
  });

  it("a ledger over $0.50 fails with the total", () => {
    const pricey = goodFacts({ summary: summariseRuns([run(MARKET, "m", 0.3, 1), run(BUILD, "m", 0.21, 1)], tasks) });
    expect(smokeProblems(pricey)).toEqual([expect.stringMatching(/agent runs cost \$0\.51.*\$0\.50/)]);
  });

  it("on the SDK runtime every smoke task ran on it with real tokens; the mock runtime is held to what it can produce", () => {
    expect(smokeProblems(goodFacts({ summary: mockSummary })).join("\n")).toMatch(/runtime.*mock/);
    expect(smokeProblems(goodFacts({ summary: mockSummary, runtime: "mock", gateway: null }))).toEqual([]);
    const silent = summariseRuns([run(MARKET, "claude-haiku-5-5", 0, 1, 0), run(BUILD, "claude-haiku-5-5", 0.1, 1)], tasks);
    expect(smokeProblems(goodFacts({ summary: silent })).join("\n")).toMatch(/market_report.*no tokens/);
  });
});

describe("TST-2 the gateway is the spend truth on the SDK runtime", () => {
  it("the spend during the run is the gateway's day spend after minus before", () => {
    expect(gatewayDeltaUsd({ beforeUsd: 0.04, afterUsd: 0.31 })).toBe(0.27);
    expect(gatewayDeltaUsd({ beforeUsd: 0.04, afterUsd: null })).toBeNull();
    expect(gatewayDeltaUsd({ beforeUsd: 0.3, afterUsd: 0.01 })).toBeNull();
    expect(gatewayDeltaUsd(null)).toBeNull();
  });

  it("a ledger of $0 while the tasks used tokens fails, even when the gateway priced the run", () => {
    const zeroLedger = summariseRuns([run(MARKET, "claude-haiku-5-5", 0, 1), run(BUILD, "claude-haiku-5-5", 0, 1)], tasks);
    expect(smokeProblems(goodFacts({ summary: zeroLedger }))).toEqual([expect.stringMatching(/agent_runs recorded \$0.*tokens.*gateway priced \$0\.2700/)]);
  });

  it("the gateway must have priced some spend, at most the cap", () => {
    expect(smokeProblems(goodFacts({ gateway: { beforeUsd: 0.04, afterUsd: 0.04 } }))).toEqual([expect.stringMatching(/gateway priced no spend/)]);
    expect(smokeProblems(goodFacts({ gateway: { beforeUsd: 0, afterUsd: 0.51 } }))).toEqual([expect.stringMatching(/gateway priced \$0\.5100.*over the \$0\.50 cap/)]);
  });

  it("a spend that cannot be read after the run, a day that rolled over, or a missing gateway fails", () => {
    expect(smokeProblems(goodFacts({ gateway: { beforeUsd: 0.04, afterUsd: null } })).join("\n")).toMatch(/could not read the gateway's spend/);
    expect(smokeProblems(goodFacts({ gateway: { beforeUsd: 0.3, afterUsd: 0.01 } })).join("\n")).toMatch(/rolled over/);
    expect(smokeProblems(goodFacts({ gateway: null })).join("\n")).toMatch(/no gateway/);
  });

  it("the mock runtime has no gateway and is not asked for one", () => {
    expect(smokeProblems(goodFacts({ summary: mockSummary, runtime: "mock", gateway: null }))).toEqual([]);
  });
});

describe("TST-2 report", () => {
  const summary = summariseRuns([run(MARKET, "claude-haiku-5-5", 0.05, 10), run(BUILD, "claude-haiku-5-5", 0.2, 20)], tasks);

  it("the JSON has exactly the evidence shape: the runtime, the gateway's mode, the ledger's total and the gateway's spend", () => {
    const report = buildReport({ sha: "abc", profile: "smoke", runtime: "claude-agent-sdk", gateway: "record", summary, gatewaySpentUsd: 0.27 });
    expect(Object.keys(report)).toEqual(["sha", "profile", "runtime", "gateway", "tasks", "totalCostUsd", "gatewaySpentUsd"]);
    expect(Object.keys(report.tasks[0] ?? {})).toEqual(["taskType", "status", "model", "inputTokens", "outputTokens", "costUsd", "durationMs", "evidenceKind"]);
    expect(report).toMatchObject({ runtime: "claude-agent-sdk", gateway: "record", totalCostUsd: 0.25, gatewaySpentUsd: 0.27 });
    expect(buildReport({ sha: "abc", profile: "smoke", runtime: "claude-agent-sdk", gateway: "replay", summary, gatewaySpentUsd: 0.27 }).gateway).toBe("replay");
    expect(buildReport({ sha: "abc", profile: "smoke", runtime: "mock", gateway: null, summary: mockSummary, gatewaySpentUsd: null })).toMatchObject({ runtime: "mock", gateway: null, gatewaySpentUsd: null });
  });

  it("the table names each task with its cost and both totals", () => {
    const one = summariseRuns([run(MARKET, "claude-haiku-5-5", 0.0512, 12_300)], tasks);
    const table = formatTable(one, { runtime: "claude-agent-sdk", gatewayUsd: 0.0613 });
    for (const part of ["market_report", "build_site", "$0.0512", "12.3 s", "ledger $0.0512", "gateway $0.0613"]) expect(table).toContain(part);
    expect(formatTable(mockSummary, { runtime: "mock", gatewayUsd: null })).toContain("gateway none (mock runtime)");
    expect(formatTable(one, { runtime: "claude-agent-sdk", gatewayUsd: null })).toContain("gateway unread");
  });

  it("the OK line carries the runtime, the ledger and the gateway, rounded to cents", () => {
    expect(okLine({ runtime: "claude-agent-sdk", ledgerUsd: 0.123, gatewayUsd: 0.1351 })).toBe("smoke LLM: OK (ledger $0.12, gateway $0.14), runtime claude-agent-sdk");
    expect(okLine({ runtime: "mock", ledgerUsd: 0, gatewayUsd: null })).toBe("smoke LLM: OK (mock runtime: ledger $0.00, no gateway)");
  });
});
