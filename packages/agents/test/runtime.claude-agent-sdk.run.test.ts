import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as AgentSdk from "@anthropic-ai/claude-agent-sdk";
import type { RoleDefinition } from "../src/roles/schema";
import type { ClaudeAgentSdkDeps } from "../src/runtime/claude-agent-sdk";
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

/** Deps whose workspaces and per-company config dirs both live inside the test's temp dir. */
const runDeps = (extra: Partial<ClaudeAgentSdkDeps> = {}): ClaudeAgentSdkDeps => ({ ...makeDeps(roles), workspaceRoot, configRoot: join(workspaceRoot, "agent-config"), ...extra });

describe("ClaudeAgentSdkRuntime.run", () => {
  it("creates the task workspace, sends the user prompt, and maps the last result", async () => {
    const output = { summary: "found", artifacts: [], memory: [], actions: [], confidence: "medium" };
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }, result({ structured_output: output })));
    const runtime = new ClaudeAgentSdkRuntime(runDeps());
    const run = await runtime.run(makeInput());
    expect(run).toMatchObject({ status: "succeeded", sessionId: "sess-live", output });
    expect((await stat(join(workspaceRoot, "task-1"))).isDirectory()).toBe(true);
    const call = queryMock.mock.calls[0]?.[0] as { prompt: string; options: { cwd: string } };
    expect(call.prompt).toContain("# Task: market_report");
    expect(call.options.cwd).toBe(join(workspaceRoot, "task-1"));
  });

  it("creates the company's config dir next to the workspace, and refuses a crafted company id before spawning", async () => {
    const configRoot = join(workspaceRoot, "agent-config");
    queryMock.mockClear();
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }));
    const deps = runDeps({ configRoot });
    await new ClaudeAgentSdkRuntime(deps).run(makeInput({ companyId: "company-9" }));
    expect((await stat(join(configRoot, "company-9"))).isDirectory()).toBe(true);
    const crafted = await new ClaudeAgentSdkRuntime(deps).run(makeInput({ companyId: "../escape" }));
    expect(crafted).toMatchObject({ status: "failed", error: expect.stringContaining("company id") });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("SEC-1 creates the company's npm cache dir, because the sandbox can only bind a path that exists", async () => {
    const configRoot = join(workspaceRoot, "agent-config");
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }));
    await new ClaudeAgentSdkRuntime(runDeps({ configRoot })).run(makeInput({ companyId: "company-8", role: "engineering", taskType: "prd" }));
    expect((await stat(join(configRoot, "company-8", "npm-cache"))).isDirectory()).toBe(true);
  });

  it("F7 refuses a crafted task id before it creates anything or spawns the SDK", async () => {
    const configRoot = join(workspaceRoot, "agent-config");
    queryMock.mockClear();
    const marker = `../north-escape-${process.pid}-${Date.now()}`;
    for (const taskId of [marker, "a/b", "..", ""]) {
      const run = await new ClaudeAgentSdkRuntime(runDeps({ configRoot })).run(makeInput({ taskId, companyId: "company-f7" }));
      expect(run, JSON.stringify(taskId)).toMatchObject({ status: "failed", error: expect.stringContaining("task id") });
    }
    expect(queryMock).not.toHaveBeenCalled();
    await expect(stat(join(workspaceRoot, marker))).rejects.toThrow();
    await expect(stat(join(workspaceRoot, "a"))).rejects.toThrow();
    await expect(stat(join(configRoot, "company-f7"))).rejects.toThrow();
  });

  it("returns failed when query throws", async () => {
    queryMock.mockImplementationOnce(() => {
      throw new Error("no api key");
    });
    const runtime = new ClaudeAgentSdkRuntime(runDeps());
    const run = await runtime.run(makeInput());
    expect(run).toMatchObject({ status: "failed", sessionId: null, error: expect.stringContaining("no api key") });
  });

  it("returns failed for unknown roles and task types without calling the SDK", async () => {
    queryMock.mockClear();
    const runtime = new ClaudeAgentSdkRuntime(runDeps());
    expect((await runtime.run(makeInput({ role: "nobody" }))).status).toBe("failed");
    expect((await runtime.run(makeInput({ taskType: "nothing" }))).status).toBe("failed");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns failed when the stream ends without a result message", async () => {
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }));
    const runtime = new ClaudeAgentSdkRuntime(runDeps());
    const run = await runtime.run(makeInput());
    expect(run).toMatchObject({ status: "failed", error: expect.stringContaining("without a result") });
  });
});

describe("B6-5 ClaudeAgentSdkRuntime run facts (BIL-2 sandbox minutes, OBS-1 trace id)", () => {
  /** A monotonic clock that advances by `steps` on each read. */
  const ticking = (...steps: number[]) => {
    let now = 0;
    return () => {
      now += steps.shift() ?? 0;
      return now;
    };
  };

  it("sandboxMinutes is the wall time of the subprocess stream, and the trace id is echoed", async () => {
    const output = { summary: "found", artifacts: [], memory: [], actions: [], confidence: "medium" };
    queryMock.mockReturnValueOnce(stream(result({ structured_output: output })));
    const runtime = new ClaudeAgentSdkRuntime(runDeps({ monotonicMs: ticking(1_000, 90_000) }));
    const run = await runtime.run(makeInput({ traceId: "trace-9" }));
    expect(run).toMatchObject({ status: "succeeded", sandboxMinutes: 1.5, traceId: "trace-9" });
  });

  it("a failed stream still reports the minutes it ran; a refusal before the subprocess reports 0", async () => {
    queryMock.mockImplementationOnce(() => {
      throw new Error("subprocess died");
    });
    const runtime = new ClaudeAgentSdkRuntime(runDeps({ monotonicMs: ticking(5, 30_000) }));
    expect(await runtime.run(makeInput())).toMatchObject({ status: "failed", sandboxMinutes: 0.5 });
    expect(await runtime.run(makeInput({ role: "nobody", traceId: "t" }))).toMatchObject({ status: "failed", sandboxMinutes: 0, traceId: "t" });
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }));
    const empty = new ClaudeAgentSdkRuntime(runDeps({ monotonicMs: ticking(0, 6_000) }));
    expect(await empty.run(makeInput())).toMatchObject({ status: "failed", sandboxMinutes: 0.1 });
  });

  it("defaults to the process's monotonic clock", async () => {
    queryMock.mockReturnValueOnce(stream({ type: "assistant" }));
    const run = await new ClaudeAgentSdkRuntime(runDeps()).run(makeInput());
    expect(run.sandboxMinutes).toBeGreaterThanOrEqual(0);
    expect(run.sandboxMinutes).toBeLessThan(1);
  });
});
