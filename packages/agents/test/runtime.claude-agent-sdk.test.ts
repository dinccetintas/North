import { beforeAll, describe, expect, it } from "vitest";
import type { HookInput, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { outputJsonSchema } from "@north/core";
import { auditHook, buildQueryOptions, mapResult, type ToolAuditEntry, type ToolCallTrace } from "../src/runtime/claude-agent-sdk";
import { MEMORY_SEARCH_TOOL } from "../src/runtime/tool-policy";
import type { RoleDefinition } from "../src/roles/schema";
import { loadTestRoles, makeDeps, makeInput, requireRole } from "./helpers";

let roles: ReadonlyMap<string, RoleDefinition>;
beforeAll(async () => {
  roles = await loadTestRoles();
});

const preToolUse = (tool_name: string): HookInput => ({
  hook_event_name: "PreToolUse",
  session_id: "s",
  transcript_path: "/tmp/t",
  cwd: "/tmp",
  tool_name,
  tool_input: { q: 1 },
  tool_use_id: "tu-1",
});

const successResult = (structured_output: unknown): SDKResultMessage =>
  ({
    type: "result",
    subtype: "success",
    uuid: "u",
    session_id: "sess-1",
    duration_ms: 1234,
    duration_api_ms: 1000,
    is_error: false,
    num_turns: 3,
    result: "done",
    stop_reason: "end_turn",
    total_cost_usd: 0.42,
    usage: {},
    modelUsage: { "claude-sonnet-5-5": { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 10, cacheCreationInputTokens: 5, webSearchRequests: 0, costUSD: 0.42, contextWindow: 1, maxOutputTokens: 1 } },
    permission_denials: [],
    structured_output,
  }) as unknown as SDKResultMessage;

describe("buildQueryOptions", () => {
  it("research: memory search plus web tools, mutating built-ins denied, sonnet, role limits", () => {
    const role = requireRole(roles, "research");
    const options = buildQueryOptions(makeInput(), role, makeDeps(roles));
    expect(options.cwd).toBe("/tmp/north-workspaces/task-1");
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.model).toBe("claude-sonnet-5-5");
    expect(options.maxTurns).toBe(30);
    expect(options.maxBudgetUsd).toBe(1.5);
    expect(options.allowedTools).toEqual([MEMORY_SEARCH_TOOL, "WebSearch", "WebFetch"]);
    expect(options.disallowedTools).toEqual(["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]);
    expect(options.outputFormat).toEqual({ type: "json_schema", schema: outputJsonSchema("market_report") });
    expect(options.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
    expect(options.mcpServers?.north).toMatchObject({ type: "sdk", name: "north" });
    expect(options.systemPrompt).toContain("You research for");
    expect(options).not.toHaveProperty("resume");
  });

  it("engineering: file and shell tools allowed, nothing disallowed, opus", () => {
    const role = requireRole(roles, "engineering");
    const options = buildQueryOptions(makeInput({ role: "engineering", taskType: "prd" }), role, makeDeps(roles));
    expect(options.model).toBe("claude-opus-5-5");
    expect(options.allowedTools).toEqual([MEMORY_SEARCH_TOOL, "Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "Bash"]);
    expect(options.disallowedTools).toEqual([]);
    expect(options.maxTurns).toBe(120);
    expect(options.maxBudgetUsd).toBe(8);
  });

  it("chief_of_staff: memory search only, plan schema, resume id when resuming", () => {
    const role = requireRole(roles, "chief_of_staff");
    const input = makeInput({ role: "chief_of_staff", taskType: "plan_week", resume: { sessionId: "sess-9", cardId: "card-1", optionId: "a" } });
    const options = buildQueryOptions(input, role, makeDeps(roles));
    expect(options.allowedTools).toEqual([MEMORY_SEARCH_TOOL]);
    expect(options.allowedTools).not.toContain("Bash");
    expect(options.disallowedTools).toContain("Bash");
    expect(options.outputFormat).toEqual({ type: "json_schema", schema: outputJsonSchema("plan_week") });
    expect(options.resume).toBe("sess-9");
  });

  it("never allows Bash for any non-engineering role", () => {
    for (const role of roles.values()) {
      if (role.role === "engineering") continue;
      const options = buildQueryOptions(makeInput({ role: role.role }), role, makeDeps(roles));
      expect(options.allowedTools, role.role).not.toContain("Bash");
      expect(options.disallowedTools, role.role).toContain("Bash");
    }
  });
});

describe("auditHook", () => {
  it("records allowed calls and returns an empty (allow) output", async () => {
    const log: ToolAuditEntry[] = [];
    const hook = auditHook(makeInput(), [MEMORY_SEARCH_TOOL], makeDeps(roles, log));
    const output = await hook(preToolUse(MEMORY_SEARCH_TOOL), "tu-1", { signal: new AbortController().signal });
    expect(output).toEqual({});
    expect(log).toEqual([{ companyId: "company-1", taskId: "task-1", toolName: MEMORY_SEARCH_TOOL, input: { q: 1 }, decision: "allow" }]);
  });

  it("records and denies tools outside the role's list", async () => {
    const log: ToolAuditEntry[] = [];
    const hook = auditHook(makeInput(), [MEMORY_SEARCH_TOOL], makeDeps(roles, log));
    const output = await hook(preToolUse("Bash"), "tu-1", { signal: new AbortController().signal });
    expect(log[0]?.decision).toBe("deny");
    expect(output).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });

  it("denies when the audit sink fails (fail closed)", async () => {
    const deps = { ...makeDeps(roles), audit: async () => Promise.reject(new Error("db down")) };
    const hook = auditHook(makeInput(), [MEMORY_SEARCH_TOOL], deps);
    const output = await hook(preToolUse(MEMORY_SEARCH_TOOL), "tu-1", { signal: new AbortController().signal });
    expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: expect.stringContaining("db down") } });
  });
});

describe("mapResult", () => {
  const output = { summary: "ok", artifacts: [], memory: [], actions: [], confidence: "high" };

  it("maps a success with valid structured output, including usage", () => {
    const result = mapResult(successResult(output), "market_report", "claude-sonnet-5-5");
    expect(result).toMatchObject({ status: "succeeded", sessionId: "sess-1", actions: [] });
    expect(result.usage).toEqual({ model: "claude-sonnet-5-5", inputTokens: 115, outputTokens: 50, costUsd: 0.42, durationMs: 1234 });
  });

  it("fails when the structured output does not match the task schema", () => {
    const result = mapResult(successResult({ summary: "" }), "market_report", "m");
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toMatch(/validation/);
  });

  it("fails on error subtypes with the SDK's message", () => {
    const errored = { ...successResult(undefined), subtype: "error_max_turns", errors: ["too many turns"] } as unknown as SDKResultMessage;
    const result = mapResult(errored, "prd", "m");
    expect(result).toMatchObject({ status: "failed", sessionId: "sess-1", error: expect.stringContaining("too many turns") });
  });
});

describe("B6-5 onToolCall (OBS-1): the worker's tracer sees every PreToolUse decision", () => {
  const signal = () => ({ signal: new AbortController().signal });

  it("receives each call after the audit with the decision, the tool use id and the run's trace id", async () => {
    const traces: ToolCallTrace[] = [];
    const deps = { ...makeDeps(roles), onToolCall: (call: ToolCallTrace) => void traces.push(call) };
    const hook = auditHook(makeInput({ traceId: "trace-1" }), [MEMORY_SEARCH_TOOL], deps);
    await hook(preToolUse(MEMORY_SEARCH_TOOL), "tu-1", signal());
    await hook(preToolUse("Bash"), "tu-1", signal());
    expect(traces).toEqual([
      { companyId: "company-1", taskId: "task-1", traceId: "trace-1", toolName: MEMORY_SEARCH_TOOL, toolUseId: "tu-1", input: { q: 1 }, decision: "allow", reason: null },
      { companyId: "company-1", taskId: "task-1", traceId: "trace-1", toolName: "Bash", toolUseId: "tu-1", input: { q: 1 }, decision: "deny", reason: expect.stringContaining("not allowed") },
    ]);
  });

  it("reports kill-switch and audit-failure denials, with a null trace id when the run has none", async () => {
    const traces: ToolCallTrace[] = [];
    const killed = { ...makeDeps(roles), isKilled: async () => true, onToolCall: async (call: ToolCallTrace) => void traces.push(call) };
    await auditHook(makeInput(), [MEMORY_SEARCH_TOOL], killed)(preToolUse(MEMORY_SEARCH_TOOL), "tu-1", signal());
    const broken = { ...makeDeps(roles), audit: async () => Promise.reject(new Error("db down")), onToolCall: (call: ToolCallTrace) => void traces.push(call) };
    await auditHook(makeInput(), [MEMORY_SEARCH_TOOL], broken)(preToolUse(MEMORY_SEARCH_TOOL), "tu-1", signal());
    expect(traces.map((t) => [t.decision, t.traceId, t.reason])).toEqual([
      ["deny", null, expect.stringContaining("Kill switch")],
      ["deny", null, expect.stringContaining("db down")],
    ]);
  });

  it("a failing tracer never changes the decision", async () => {
    const throwing = { ...makeDeps(roles), onToolCall: () => Promise.reject(new Error("langfuse down")) };
    expect(await auditHook(makeInput(), [MEMORY_SEARCH_TOOL], throwing)(preToolUse(MEMORY_SEARCH_TOOL), "tu-1", signal())).toEqual({});
    const syncThrow = { ...makeDeps(roles), onToolCall: () => { throw new Error("boom"); } };
    expect(await auditHook(makeInput(), [MEMORY_SEARCH_TOOL], syncThrow)(preToolUse("Bash"), "tu-1", signal())).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("buildQueryOptions wires the same hook, so the tracer sees calls of a real run", async () => {
    const traces: ToolCallTrace[] = [];
    const deps = { ...makeDeps(roles), onToolCall: (call: ToolCallTrace) => void traces.push(call) };
    const options = buildQueryOptions(makeInput({ traceId: "trace-2" }), requireRole(roles, "research"), deps);
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    await hook?.(preToolUse("WebSearch"), "tu-1", signal());
    expect(traces).toMatchObject([{ toolName: "WebSearch", decision: "allow", traceId: "trace-2" }]);
  });
});
