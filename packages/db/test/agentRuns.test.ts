import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAgentRun } from "../src/agentRuns";
import { createTask } from "../src/tasks";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("agent runs repository", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("agentruns");
    stranger = await createTestUser("agentruns-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("recordAgentRun stores model, tokens, cost, duration and status", async () => {
    const task = await createTask(owned.owner.client, { companyId: owned.companyId, role: "research", taskType: "market_report", title: "t" });
    const id = await recordAgentRun(owned.owner.client, {
      companyId: owned.companyId,
      taskId: task.id,
      role: "research",
      model: "drafter",
      runtime: "mock",
      sessionId: null,
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.012,
      durationMs: 850,
      status: "succeeded",
    });
    const row = await service.from("agent_runs").select("task_id, role, model, runtime, session_id, input_tokens, output_tokens, cost_usd, duration_ms, status, error").eq("id", id).single();
    expect(row.data).toEqual({ task_id: task.id, role: "research", model: "drafter", runtime: "mock", session_id: null, input_tokens: 1200, output_tokens: 300, cost_usd: 0.012, duration_ms: 850, status: "succeeded", error: null });
  });

  it("records a failed run with its error and rejects an unknown runtime", async () => {
    const id = await recordAgentRun(owned.owner.client, { companyId: owned.companyId, taskId: null, role: "research", model: "drafter", runtime: "claude-agent-sdk", sessionId: "sess-1", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 10, status: "failed", error: "timeout" });
    const row = await service.from("agent_runs").select("status, error, session_id").eq("id", id).single();
    expect(row.data).toEqual({ status: "failed", error: "timeout", session_id: "sess-1" });
    await expect(recordAgentRun(owned.owner.client, { companyId: owned.companyId, taskId: null, role: "research", model: "m", runtime: "openai" as never, sessionId: null, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, status: "succeeded" })).rejects.toThrow();
  });

  it("another owner cannot record runs for the company", async () => {
    await expect(recordAgentRun(stranger.client, { companyId: owned.companyId, taskId: null, role: "research", model: "m", runtime: "mock", sessionId: null, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, status: "succeeded" })).rejects.toThrow();
  });
});
