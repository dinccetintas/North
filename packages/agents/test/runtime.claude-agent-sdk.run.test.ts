import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as AgentSdk from "@anthropic-ai/claude-agent-sdk";
import type { RoleDefinition } from "../src/roles/schema";
import { loadTestRoles, makeDeps, makeInput } from "./helpers";

const queryMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentSdk>();
  return { ...actual, query: (...args: unknown[]) => queryMock(...args) };
});

const { ClaudeAgentSdkRuntime } = await import("../src/runtime/claude-agent-sdk");

async function* stream(...messages: unknown[]) {
  for (const message of messages) yield message;
}

const result = (overrides: Record<string, unknown>) => ({
  type: "result",
  subtype: "success",
  session_id: "sess-live",
  duration_ms: 10,
  total_cost_usd: 0.05,
  modelUsage: {},
  result: "",
  ...overrides,
});

let roles: ReadonlyMap<string, RoleDefinition>;
let workspaceRoot: string;
beforeAll(async () => {
  roles = await loadTestRoles();
  workspaceRoot = await mkdtemp(join(tmpdir(), "north-agents-"));
});
afterAll(async () => rm(workspaceRoot, { recursive: true, force: true }));

describe("ClaudeAgentSdkRuntime.run", () => {
  it("creates the task workspace, sends the user prompt, and maps the last result", async () => {
    const output = { summary: "found", artifacts: [], memory: [], actions: [], confidence: "medium" };
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }, result({ structured_output: output })));
    const runtime = new ClaudeAgentSdkRuntime({ ...makeDeps(roles), workspaceRoot });
    const run = await runtime.run(makeInput());
    expect(run).toMatchObject({ status: "succeeded", sessionId: "sess-live", output });
    expect((await stat(join(workspaceRoot, "task-1"))).isDirectory()).toBe(true);
    const call = queryMock.mock.calls[0]?.[0] as { prompt: string; options: { cwd: string } };
    expect(call.prompt).toContain("# Task: market_report");
    expect(call.options.cwd).toBe(join(workspaceRoot, "task-1"));
  });

  it("returns failed when query throws", async () => {
    queryMock.mockImplementationOnce(() => {
      throw new Error("no api key");
    });
    const runtime = new ClaudeAgentSdkRuntime({ ...makeDeps(roles), workspaceRoot });
    const run = await runtime.run(makeInput());
    expect(run).toMatchObject({ status: "failed", sessionId: null, error: expect.stringContaining("no api key") });
  });

  it("returns failed for unknown roles and task types without calling the SDK", async () => {
    queryMock.mockClear();
    const runtime = new ClaudeAgentSdkRuntime({ ...makeDeps(roles), workspaceRoot });
    expect((await runtime.run(makeInput({ role: "nobody" }))).status).toBe("failed");
    expect((await runtime.run(makeInput({ taskType: "nothing" }))).status).toBe("failed");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns failed when the stream ends without a result message", async () => {
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }));
    const runtime = new ClaudeAgentSdkRuntime({ ...makeDeps(roles), workspaceRoot });
    const run = await runtime.run(makeInput());
    expect(run).toMatchObject({ status: "failed", error: expect.stringContaining("without a result") });
  });
});
