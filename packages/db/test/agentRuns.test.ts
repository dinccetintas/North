import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { costSummary, listRecentRuns, recordAgentRun, sumRunCostsSince, type RecordAgentRunInput } from "../src/agentRuns";
import { DbError } from "../src/errors";
import { createTask } from "../src/tasks";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, service, type OwnedCompany, type TestUser } from "./fixtures";

const run = (companyId: string, overrides: Partial<RecordAgentRunInput> = {}): RecordAgentRunInput => ({
  companyId,
  taskId: null,
  role: "research",
  model: "drafter",
  runtime: "mock",
  sessionId: null,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  durationMs: 0,
  status: "succeeded",
  ...overrides,
});

describe("agent runs repository (OBS-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("agentruns");
    stranger = await createTestUser("agentruns-stranger");
    // A second company for the cost test: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "pro");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("recordAgentRun (worker) stores model, tokens, cost, duration and status", async () => {
    const task = await createTask(service, { companyId: owned.companyId, role: "research", taskType: "market_report", title: "t" });
    const id = await recordAgentRun(service, run(owned.companyId, { taskId: task.id, inputTokens: 1200, outputTokens: 300, costUsd: 0.012, durationMs: 850 }));
    const row = await service.from("agent_runs").select("task_id, role, model, runtime, session_id, input_tokens, output_tokens, cost_usd, duration_ms, status, error").eq("id", id).single();
    expect(row.data).toEqual({ task_id: task.id, role: "research", model: "drafter", runtime: "mock", session_id: null, input_tokens: 1200, output_tokens: 300, cost_usd: 0.012, duration_ms: 850, status: "succeeded", error: null });
  });

  it("records a failed run with its error and rejects an unknown runtime", async () => {
    const id = await recordAgentRun(service, run(owned.companyId, { runtime: "claude-agent-sdk", sessionId: "sess-1", durationMs: 10, status: "failed", error: "timeout" }));
    const row = await service.from("agent_runs").select("status, error, session_id").eq("id", id).single();
    expect(row.data).toEqual({ status: "failed", error: "timeout", session_id: "sess-1" });
    await expect(recordAgentRun(service, run(owned.companyId, { runtime: "openai" as never }))).rejects.toThrow();
  });

  it("OBS-1: owners and strangers read but never record runs", async () => {
    await expect(recordAgentRun(owned.owner.client, run(owned.companyId))).rejects.toBeInstanceOf(DbError);
    await expect(recordAgentRun(stranger.client, run(owned.companyId))).rejects.toBeInstanceOf(DbError);
    expect((await listRecentRuns(owned.owner.client, owned.companyId, 10)).length).toBe(2);
    expect(await listRecentRuns(stranger.client, owned.companyId, 10)).toEqual([]);
  });

  it("listRecentRuns is newest first with the full record and honours the limit", async () => {
    const runs = await listRecentRuns(owned.owner.client, owned.companyId, 10);
    expect(runs.map((r) => r.status)).toEqual(["failed", "succeeded"]);
    expect(runs[0]).toMatchObject({ companyId: owned.companyId, taskId: null, role: "research", model: "drafter", runtime: "claude-agent-sdk", sessionId: "sess-1", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 10, status: "failed", error: "timeout" });
    expect(typeof runs[0]?.id).toBe("string");
    expect(typeof runs[0]?.createdAt).toBe("string");
    expect(Object.isFrozen(runs)).toBe(true);
    expect(Object.isFrozen(runs[0])).toBe(true);
    expect((await listRecentRuns(owned.owner.client, owned.companyId, 1)).length).toBe(1);
  });

  it("costSummary aggregates runs, tokens and cost by role and by day inside the window", async () => {
    const companyId = await createCompanyFor(owned.owner, "agentruns-cost");
    expect(await costSummary(owned.owner.client, companyId, 30)).toEqual({ runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byRole: [], byDay: [] });
    await recordAgentRun(service, run(companyId, { role: "research", inputTokens: 1000, outputTokens: 200, costUsd: 0.5 }));
    await recordAgentRun(service, run(companyId, { role: "research", inputTokens: 500, outputTokens: 100, costUsd: 0.25, status: "failed", error: "x" }));
    await recordAgentRun(service, run(companyId, { role: "engineering", inputTokens: 4000, outputTokens: 1000, costUsd: 2 }));
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await service.from("agent_runs").insert({ company_id: companyId, role: "design", model: "m", runtime: "mock", status: "succeeded", cost_usd: 100, input_tokens: 9, created_at: old });
    const summary = await costSummary(owned.owner.client, companyId, 30);
    const today = new Date().toISOString().slice(0, 10);
    expect(summary).toEqual({
      runs: 3,
      inputTokens: 5500,
      outputTokens: 1300,
      costUsd: 2.75,
      byRole: [
        { role: "engineering", runs: 1, inputTokens: 4000, outputTokens: 1000, costUsd: 2 },
        { role: "research", runs: 2, inputTokens: 1500, outputTokens: 300, costUsd: 0.75 },
      ],
      byDay: [{ day: today, runs: 3, costUsd: 2.75 }],
    });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.byRole)).toBe(true);
    expect((await costSummary(service, companyId, 60)).costUsd).toBe(102.75);
    expect(await costSummary(stranger.client, companyId, 30)).toMatchObject({ runs: 0, costUsd: 0 });
    await expect(costSummary(service, companyId, 0)).rejects.toThrow();
  });

  it("STG-1 sumRunCostsSince (service role) sums every company's agent_runs.cost_usd from an instant on, and refuses a non-ISO instant", async () => {
    const companyId = await createCompanyFor(owned.owner, "agentruns-since");
    const since = new Date(Date.now() - 60_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const before = { since: await sumRunCostsSince(service, since), dayAgo: await sumRunCostsSince(service, dayAgo), threeDaysAgo: await sumRunCostsSince(service, threeDaysAgo) };
    await recordAgentRun(service, run(companyId, { costUsd: 0.25 }));
    await recordAgentRun(service, run(owned.companyId, { costUsd: 0.125 }));
    await service.from("agent_runs").insert({ company_id: companyId, role: "design", model: "m", runtime: "mock", status: "succeeded", cost_usd: 100, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect((await sumRunCostsSince(service, since)) - before.since).toBeCloseTo(0.375, 9);
    expect((await sumRunCostsSince(service, dayAgo)) - before.dayAgo).toBeCloseTo(0.375, 9);
    expect((await sumRunCostsSince(service, threeDaysAgo)) - before.threeDaysAgo).toBeCloseTo(100.375, 9);
    expect(await sumRunCostsSince(service, "2999-01-01T00:00:00.000Z")).toBe(0);
    await expect(sumRunCostsSince(service, "today")).rejects.toThrow();
  });

  it("STG-1 sumRunCostsSince reads every page: 1001 runs in one window add up exactly", async () => {
    const companyId = owned.companyId;
    const window = "2001-01-01T00:00:00.000Z";
    const before = await sumRunCostsSince(service, window);
    const rows = Array.from({ length: 1001 }, (_, i) => ({ company_id: companyId, role: "research", model: "m", runtime: "mock", status: "succeeded", cost_usd: 0.001, created_at: new Date(Date.parse(window) + i * 1000).toISOString() }));
    const { error } = await service.from("agent_runs").insert(rows);
    expect(error).toBeNull();
    expect((await sumRunCostsSince(service, window)) - before).toBeCloseTo(1.001, 9);
  });

  it("OBS-1 (M6): a run carries its Langfuse trace id, null without a tracer", async () => {
    const traced = await recordAgentRun(service, run(owned.companyId, { traceId: "trace-abc123" }));
    const plain = await recordAgentRun(service, run(owned.companyId));
    const runs = await listRecentRuns(owned.owner.client, owned.companyId, 10);
    expect(runs.find((r) => r.id === traced)?.traceId).toBe("trace-abc123");
    expect(runs.find((r) => r.id === plain)?.traceId).toBeNull();
    await expect(recordAgentRun(service, run(owned.companyId, { traceId: "x".repeat(201) }))).rejects.toThrow();
  });
});
