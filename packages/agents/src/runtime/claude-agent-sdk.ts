import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createSdkMcpServer, query, tool, type HookCallback, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AgentOutputSchema, PlanOutputSchema, TASK_TYPES, outputJsonSchema, resolveModel, type TaskType } from "@north/core";
import { buildTaskPrompt } from "../prompts/build";
import type { RoleDefinition } from "../roles/schema";
import { allowedToolsFor, disallowedToolsFor } from "./tool-policy";
import type { AgentRunInput, AgentRunResult, AgentRunUsage, AgentRuntime } from "./types";

/** One memory item returned by the host's search. */
export interface MemoryHit {
  readonly title: string;
  readonly content: string;
  readonly kind: string;
}

/** One audited tool call; the host persists it (audit_log). */
export interface ToolAuditEntry {
  readonly companyId: string;
  readonly taskId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly decision: "allow" | "deny";
}

/** Host callbacks the runtime needs; it never sees credentials. */
export interface ClaudeAgentSdkDeps {
  readonly roles: ReadonlyMap<string, RoleDefinition>;
  readonly memorySearch: (companyId: string, query: string) => Promise<readonly MemoryHit[]>;
  readonly audit: (entry: ToolAuditEntry) => Promise<void>;
  readonly workspaceRoot: string;
}

const NORTH_SERVER_VERSION = "0.1.0";

const isTaskType = (value: string): value is TaskType => (TASK_TYPES as readonly string[]).includes(value);

/** Per-task workspace directory: `<workspaceRoot>/<taskId>`. */
export function taskWorkspace(workspaceRoot: string, taskId: string): string {
  return join(workspaceRoot, taskId);
}

const renderHits = (hits: readonly MemoryHit[]): string =>
  hits.length === 0 ? "No matching memory." : hits.map((h) => `## ${h.title} (${h.kind})\n${h.content}`).join("\n\n");

/** In-process MCP tool: searches company memory through the host callback; errors come back as tool errors, never throws. */
export function memorySearchTool(input: AgentRunInput, deps: ClaudeAgentSdkDeps) {
  return tool(
    "memory_search",
    "Search this company's memory (thesis, personas, decisions, learnings, docs). Returns the best matching items as text.",
    { query: z.string().min(1).max(500) },
    async ({ query: text }) => {
      try {
        const hits = await deps.memorySearch(input.companyId, text);
        return { content: [{ type: "text" as const, text: renderHits(hits) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `memory_search failed: ${message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: false } },
  );
}

/**
 * PreToolUse hook: records every call through `deps.audit` and denies tools
 * outside the role's allowed list. An audit failure denies too (fail closed).
 */
export function auditHook(input: AgentRunInput, allowed: readonly string[], deps: ClaudeAgentSdkDeps): HookCallback {
  return async (hookInput) => {
    if (hookInput.hook_event_name !== "PreToolUse") return {};
    const permitted = allowed.includes(hookInput.tool_name);
    const entry: ToolAuditEntry = {
      companyId: input.companyId,
      taskId: input.taskId,
      toolName: hookInput.tool_name,
      input: hookInput.tool_input,
      decision: permitted ? "allow" : "deny",
    };
    let reason = permitted ? undefined : `Tool "${hookInput.tool_name}" is not allowed for role "${input.role}"`;
    try {
      await deps.audit(entry);
    } catch (error) {
      reason = `Audit unavailable (${error instanceof Error ? error.message : String(error)}); call denied`;
    }
    if (reason === undefined) return {};
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  };
}

/** Pure builder for the Agent SDK `query()` options (ADR 0004). Does not touch the filesystem. */
export function buildQueryOptions(input: AgentRunInput, role: RoleDefinition, deps: ClaudeAgentSdkDeps): Options {
  const allowedTools = allowedToolsFor(role);
  const taskType = isTaskType(input.taskType) ? input.taskType : undefined;
  const { system } = buildTaskPrompt(input, role, input.vars ?? {});
  return {
    cwd: taskWorkspace(deps.workspaceRoot, input.taskId),
    settingSources: [],
    permissionMode: "dontAsk",
    model: resolveModel(role.model),
    maxTurns: role.max_turns,
    maxBudgetUsd: role.max_budget_usd,
    allowedTools: [...allowedTools],
    disallowedTools: [...disallowedToolsFor(role)],
    mcpServers: { north: createSdkMcpServer({ name: "north", version: NORTH_SERVER_VERSION, tools: [memorySearchTool(input, deps)] }) },
    outputFormat: { type: "json_schema", schema: taskType ? outputJsonSchema(taskType) : input.outputSchema },
    hooks: { PreToolUse: [{ hooks: [auditHook(input, allowedTools, deps)] }] },
    systemPrompt: system,
    ...(input.resume ? { resume: input.resume.sessionId } : {}),
  };
}

const zeroUsage = (model: string): AgentRunUsage => Object.freeze({ model, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 });

const failed = (error: string, sessionId: string | null, usage: AgentRunUsage): AgentRunResult =>
  Object.freeze({ status: "failed", error, sessionId, usage });

/** Maps the SDK's per-model usage onto North's flat usage record. */
export function usageOf(result: SDKResultMessage, model: string): AgentRunUsage {
  const models = Object.values(result.modelUsage ?? {});
  return Object.freeze({
    model,
    inputTokens: models.reduce((sum, m) => sum + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0),
    outputTokens: models.reduce((sum, m) => sum + m.outputTokens, 0),
    costUsd: result.total_cost_usd ?? 0,
    durationMs: result.duration_ms ?? 0,
  });
}

/** Maps the final SDK result onto `AgentRunResult`, validating the structured output against the task schema. */
export function mapResult(result: SDKResultMessage, taskType: TaskType, model: string): AgentRunResult {
  const usage = usageOf(result, model);
  if (result.subtype !== "success") {
    const detail = "errors" in result && Array.isArray(result.errors) ? result.errors.join("; ") : result.subtype;
    return failed(`Agent SDK run ended with ${result.subtype}: ${detail}`, result.session_id, usage);
  }
  if (result.structured_output === undefined) {
    return failed(`Agent SDK returned no structured output (${result.result.slice(0, 200)})`, result.session_id, usage);
  }
  // TODO(M2): when a North tool handler returns a `card` gate result, end the run with
  // `waiting_decision` carrying the card id. Until then a card request surfaces as failed.
  const schema = taskType === "plan_week" ? PlanOutputSchema : AgentOutputSchema;
  const parsed = schema.safeParse(result.structured_output);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failed(`Structured output failed validation: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(), result.session_id, usage);
  }
  const actions = "actions" in parsed.data ? parsed.data.actions : [];
  return Object.freeze({ status: "succeeded", output: parsed.data, actions, sessionId: result.session_id, usage });
}

/** Production adapter over `query()` from `@anthropic-ai/claude-agent-sdk` (ADR 0004). */
export class ClaudeAgentSdkRuntime implements AgentRuntime {
  readonly name = "claude-agent-sdk" as const;

  constructor(private readonly deps: ClaudeAgentSdkDeps) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const role = this.deps.roles.get(input.role);
    if (!role) return failed(`Unknown role "${input.role}"`, null, zeroUsage("unknown"));
    if (!isTaskType(input.taskType)) return failed(`Unknown task type "${input.taskType}"`, null, zeroUsage(resolveModel(role.model)));
    const model = resolveModel(role.model);
    try {
      await mkdir(taskWorkspace(this.deps.workspaceRoot, input.taskId), { recursive: true });
      const options = buildQueryOptions(input, role, this.deps);
      const { user } = buildTaskPrompt(input, role, input.vars ?? {});
      let last: SDKResultMessage | undefined;
      for await (const message of query({ prompt: user, options })) {
        if (message.type === "result") last = message;
      }
      if (!last) return failed("Agent SDK stream ended without a result message", null, zeroUsage(model));
      return mapResult(last, input.taskType, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failed(`Agent SDK run failed: ${message}`, input.resume?.sessionId ?? null, zeroUsage(model));
    }
  }
}
