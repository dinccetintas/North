import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { outputJsonSchema } from "@north/core";
import { auditHook, buildQueryOptions, mapResult, memorySearchTool, taskWorkspace, usageOf, type ClaudeAgentSdkDeps, type ToolAuditEntry, type ToolCallTrace } from "../src/runtime/claude-agent-sdk";
import { memorySearchTool as memorySearchToolModule, type MemoryHit } from "../src/runtime/memory-tool";
import { allowedToolsFor, MEMORY_SEARCH_TOOL } from "../src/runtime/tool-policy";
import type { RoleDefinition } from "../src/roles/schema";
import { loadTestRoles, makeDeps, makeInput, preToolUse, requireRole } from "./helpers";

let roles: ReadonlyMap<string, RoleDefinition>;
beforeAll(async () => {
  roles = await loadTestRoles();
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
    expect(result.usage).toEqual({ model: "claude-sonnet-5-5", inputTokens: 115, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, costUsd: 0.42, durationMs: 1234 });
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

/** The deps without a gateway: the pre-Task-12 shape the worker still builds. */
const withoutGateway = (): ClaudeAgentSdkDeps => {
  const { gatewayBaseUrl, ...rest } = makeDeps(roles);
  void gatewayBaseUrl;
  return rest;
};

describe("SEC-1 / TST-1 query options", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("engineering runs sandboxed, with no unsandboxed commands and the npm registry only", () => {
    const options = buildQueryOptions(makeInput({ role: "engineering", taskType: "prd" }), requireRole(roles, "engineering"), makeDeps(roles));
    expect(options.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      network: { allowedDomains: ["registry.npmjs.org"] },
      filesystem: {
        denyRead: ["/tmp/north-agent-config", "/tmp/north-workspaces"],
        allowRead: ["/tmp/north-workspaces/task-1", "/tmp/north-agent-config/company-1"],
        allowWrite: ["/tmp/north-agent-config/company-1/npm-cache"],
      },
    });
  });

  it("F3 an empty gateway URL is refused instead of silently falling back to the host key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-host");
    const deps = { ...makeDeps(roles), gatewayBaseUrl: "" };
    expect(() => buildQueryOptions(makeInput(), requireRole(roles, "research"), deps)).toThrow(/gateway URL/);
  });

  it("F7 a crafted task id cannot reach outside the workspace root", () => {
    for (const taskId of ["../escape", "a/b", "", "..", "t\0"]) {
      expect(() => buildQueryOptions(makeInput({ taskId }), requireRole(roles, "research"), makeDeps(roles)), JSON.stringify(taskId)).toThrow(/task id/);
      expect(() => taskWorkspace("/tmp/north-workspaces", taskId), JSON.stringify(taskId)).toThrow(/task id/);
    }
    expect(taskWorkspace("/tmp/north-workspaces", "0b9f2c1e-7a34-4d58-9e61-2f5c8a1d3b70")).toBe("/tmp/north-workspaces/0b9f2c1e-7a34-4d58-9e61-2f5c8a1d3b70");
  });

  it("no other role gets a sandbox block, because none of them can run a shell", () => {
    for (const role of roles.values()) {
      if (role.role === "engineering") continue;
      expect(buildQueryOptions(makeInput({ role: role.role }), role, makeDeps(roles)), role.role).not.toHaveProperty("sandbox");
    }
  });

  it("research gets an explicit tools list without Bash or Write, no skills, and skill shell execution off", () => {
    const options = buildQueryOptions(makeInput(), requireRole(roles, "research"), makeDeps(roles));
    expect(options.tools).toEqual(["WebSearch", "WebFetch"]);
    expect(options.tools).not.toContain("Bash");
    expect(options.tools).not.toContain("Write");
    expect(options.skills).toEqual([]);
    expect(options.settings).toEqual({ disableSkillShellExecution: true });
  });

  it("tools is the allowed built-ins of every role: the allow-list minus the mcp entries", () => {
    for (const role of roles.values()) {
      const options = buildQueryOptions(makeInput({ role: role.role }), role, makeDeps(roles));
      expect(options.tools, role.role).toEqual(allowedToolsFor(role).filter((name) => !name.startsWith("mcp__")));
    }
    const engineering = buildQueryOptions(makeInput({ role: "engineering" }), requireRole(roles, "engineering"), makeDeps(roles));
    expect(engineering.tools).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "Bash"]);
    expect(buildQueryOptions(makeInput({ role: "chief_of_staff" }), requireRole(roles, "chief_of_staff"), makeDeps(roles)).tools).toEqual([]);
  });

  it("production routes by alias: sonnet at medium for research, opus at xhigh for engineering", () => {
    const research = buildQueryOptions(makeInput(), requireRole(roles, "research"), makeDeps(roles));
    expect([research.model, research.effort]).toEqual(["claude-sonnet-5-5", "medium"]);
    const engineering = buildQueryOptions(makeInput({ role: "engineering" }), requireRole(roles, "engineering"), makeDeps(roles));
    expect([engineering.model, engineering.effort]).toEqual(["claude-opus-5-5", "xhigh"]);
  });

  it("the smoke profile routes research to haiku at low effort", () => {
    const options = buildQueryOptions(makeInput(), requireRole(roles, "research"), { ...makeDeps(roles), profile: "smoke" });
    expect([options.model, options.effort]).toEqual(["claude-haiku-5-5", "low"]);
  });

  it("the profile defaults to production when the deps carry none", () => {
    const { profile, ...rest } = makeDeps(roles);
    void profile;
    const options = buildQueryOptions(makeInput(), requireRole(roles, "research"), rest);
    expect([options.model, options.effort]).toEqual(["claude-sonnet-5-5", "medium"]);
  });

  it("the subprocess env points at the gateway with a placeholder key and a per-company config dir", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-host");
    const deps = { ...makeDeps(roles), subprocessEnv: { PATH: "/usr/bin" } };
    const env = buildQueryOptions(makeInput({ companyId: "company-7" }), requireRole(roles, "research"), deps).env ?? {};
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4310",
      ANTHROPIC_API_KEY: "north-gateway",
      HOME: "/tmp/north-agent-config/company-7",
      CLAUDE_CONFIG_DIR: "/tmp/north-agent-config/company-7",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
    });
    expect(JSON.stringify(env)).not.toContain("sk-ant-host");
  });

  it("the config root defaults to agent-config next to the workspace root", () => {
    const { configRoot, ...rest } = makeDeps(roles);
    void configRoot;
    const env = buildQueryOptions(makeInput(), requireRole(roles, "research"), rest).env ?? {};
    expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/agent-config/company-1");
  });

  it("without a gateway the host key still passes through (until the worker wires one) and warns once", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-host");
    const warn = vi.fn();
    const env = buildQueryOptions(makeInput(), requireRole(roles, "research"), { ...withoutGateway(), warn }).env ?? {};
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-host");
    expect(env).not.toHaveProperty("ANTHROPIC_BASE_URL");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("no model gateway configured: the model key is exposed to the agent subprocess");
  });

  it("a crafted company id cannot reach outside the config root", () => {
    expect(() => buildQueryOptions(makeInput({ companyId: "../../etc" }), requireRole(roles, "research"), makeDeps(roles))).toThrow(/company id/);
  });

  it("attaches a session store scoped to the run's company only when session entries are provided", async () => {
    const research = requireRole(roles, "research");
    expect(buildQueryOptions(makeInput(), research, makeDeps(roles))).not.toHaveProperty("sessionStore");
    expect(buildQueryOptions(makeInput(), research, makeDeps(roles))).not.toHaveProperty("sessionStoreFlush");

    const appended: Array<{ sessionId: string; fromSeq: number }> = [];
    const sessionEntries: NonNullable<ClaudeAgentSdkDeps["sessionEntries"]> = {
      append: async (sessionId, _subpath, entries, fromSeq) => (appended.push({ sessionId, fromSeq }), fromSeq + entries.length),
      read: async () => [],
      companyOf: async (sessionId) => (sessionId === "foreign" ? "company-2" : null),
    };
    const options = buildQueryOptions(makeInput(), research, { ...makeDeps(roles), sessionEntries });
    expect(options.sessionStoreFlush).toBe("batched");
    const store = options.sessionStore;
    expect(store).toBeDefined();
    await store?.append({ projectKey: "p", sessionId: "s1" }, [{ type: "user", uuid: "u1" }]);
    expect(appended).toEqual([{ sessionId: "s1", fromSeq: 0 }]);
    await expect(store?.load({ projectKey: "p", sessionId: "foreign" })).rejects.toThrow("belongs to another company");
  });

  it("routes the session store's warnings to deps.warn", async () => {
    const warn = vi.fn();
    const sessionEntries: NonNullable<ClaudeAgentSdkDeps["sessionEntries"]> = { append: async (_s, _p, e, from) => from + e.length, read: async () => [], companyOf: async () => null };
    const options = buildQueryOptions(makeInput(), requireRole(roles, "research"), { ...makeDeps(roles), sessionEntries, warn });
    await options.sessionStore?.append({ projectKey: "p", sessionId: "s1" }, [{ type: "user", text: "a\u0000" }]);
    expect(warn).toHaveBeenCalledWith("session s1: replaced 1 unencodable characters");
  });
});

describe("M7 memory tool module and usage", () => {
  it("memorySearchTool lives in memory-tool.ts and is still re-exported from the adapter", () => {
    expect(memorySearchTool).toBe(memorySearchToolModule);
  });

  it("a memory hit may carry the department the db hit has", () => {
    const hit: MemoryHit = { title: "t", content: "c", kind: "learning", department: null };
    expect(hit.department).toBeNull();
  });

  it("usageOf sums the cache read and write tokens across models, and inputTokens still counts them", () => {
    const base = successResult({});
    const model = { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 30, cacheCreationInputTokens: 4, webSearchRequests: 0, costUSD: 0, contextWindow: 1, maxOutputTokens: 1 };
    const result = { ...base, modelUsage: { a: model, b: { ...model, cacheReadInputTokens: 50, cacheCreationInputTokens: 6 } } } as unknown as SDKResultMessage;
    expect(usageOf(result, "m")).toMatchObject({ cacheReadTokens: 80, cacheWriteTokens: 10, outputTokens: 4, inputTokens: 1 + 30 + 4 + 1 + 50 + 6 });
  });

  it("usageOf reports zero cache tokens when the result carries no model usage", () => {
    const bare = { ...successResult({}), modelUsage: undefined } as unknown as SDKResultMessage;
    expect(usageOf(bare, "m")).toMatchObject({ cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});
