// The production AgentRuntime over the Agent SDK's `query()` (ADR 0004): option
// building (model profile, tool lists, sandbox, per-company env, session store),
// the PreToolUse audit hook, and result mapping. Credentials never enter here.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSdkMcpServer, query, type HookCallback, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { AgentOutputSchema, DEFAULT_PROFILE, PlanOutputSchema, TASK_TYPES, outputJsonSchema, resolveEffort, resolveModel, type ModelProfile, type TaskType } from "@north/core";
import { buildTaskPrompt } from "../prompts/build";
import type { RoleDefinition } from "../roles/schema";
import { elapsedMinutes, withRunMeta } from "./meta";
import { memorySearchTool, type MemoryHit } from "./memory-tool";
import { PATH_SCOPED_TOOLS, PathSegmentSchema, pathArgumentsOf, pathOutsideWorkspace } from "./path-scope";
import { createNorthSessionStore, type SessionEntriesPort } from "./session-store";
import { companyConfigDir, defaultConfigRoot, minimalSubprocessEnv, npmCacheDir, subprocessEnvFor } from "./subprocess-env";
import { ENGINEERING_ROLE, allowedToolsFor, disallowedToolsFor } from "./tool-policy";
import type { AgentRunInput, AgentRunResult, AgentRunUsage, AgentRuntime } from "./types";

// memorySearchTool and MemoryHit moved to memory-tool.ts; re-exported so existing imports keep compiling.
export { memorySearchTool, type MemoryHit };

/** One audited tool call; the host persists it (audit_log). */
export interface ToolAuditEntry {
  readonly companyId: string;
  readonly taskId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly decision: "allow" | "deny";
}

/** One PreToolUse decision as the worker's tracer sees it (OBS-1): the audit entry plus the call id, the run's trace and why it was denied. */
export interface ToolCallTrace extends ToolAuditEntry {
  readonly toolUseId: string;
  /** `AgentRunInput.traceId`; null when the run is not traced. */
  readonly traceId: string | null;
  /** Null when allowed. */
  readonly reason: string | null;
}

/** Host callbacks the runtime needs; it never sees credentials. */
export interface ClaudeAgentSdkDeps {
  readonly roles: ReadonlyMap<string, RoleDefinition>;
  readonly memorySearch: (companyId: string, query: string) => Promise<readonly MemoryHit[]>;
  readonly audit: (entry: ToolAuditEntry) => Promise<void>;
  readonly workspaceRoot: string;
  /** Kill switch probe: when it resolves true (or throws) every further tool call is denied. */
  readonly isKilled?: (companyId: string) => Promise<boolean>;
  /** Base environment of the agent subprocess; defaults to `minimalSubprocessEnv(process.env)`. Each run adds its company's HOME and the gateway. */
  readonly subprocessEnv?: Readonly<Record<string, string>>;
  /** Model profile (TST-1) that routes role aliases to models and effort; defaults to `DEFAULT_PROFILE` (production). */
  readonly profile?: ModelProfile;
  /** SEC-1: the model gateway the subprocess talks to (`ANTHROPIC_BASE_URL`). Absent: the host key passes through and `warn` is called. */
  readonly gatewayBaseUrl?: string;
  /** Root of the per-company agent config dirs (`<configRoot>/<companyId>` is HOME and CLAUDE_CONFIG_DIR); defaults to `agent-config` next to `workspaceRoot`. */
  readonly configRoot?: string;
  /** SEC-2: where session transcripts are mirrored (the worker wires `@north/db`); absent: transcripts stay in the company's config dir only. */
  readonly sessionEntries?: SessionEntriesPort;
  /** Operational warnings (an exposed key, replaced characters); defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
  /**
   * OBS-1: called for every PreToolUse decision after the audit, allowed or
   * denied, so the worker's tracer can add a span. Observability only: a
   * failure here is swallowed and never changes the decision.
   */
  readonly onToolCall?: (call: ToolCallTrace) => void | Promise<void>;
  /** Monotonic milliseconds for the subprocess wall time (`sandboxMinutes`); defaults to `performance.now`. */
  readonly monotonicMs?: () => number;
}

const NORTH_SERVER_VERSION = "0.1.0";

const isTaskType = (value: string): value is TaskType => (TASK_TYPES as readonly string[]).includes(value);

/** Per-task workspace directory: `<workspaceRoot>/<taskId>`; throws when the id could step outside the root. */
export function taskWorkspace(workspaceRoot: string, taskId: string): string {
  if (!PathSegmentSchema.safeParse(taskId).success) {
    throw new Error(`Invalid task id for the task workspace: ${JSON.stringify(taskId)}`);
  }
  return join(workspaceRoot, taskId);
}

/** Hands one decision to the tracer; tracing never decides a tool call, so its errors stop here. */
async function traceToolCall(deps: ClaudeAgentSdkDeps, call: ToolCallTrace): Promise<void> {
  if (!deps.onToolCall) return;
  try {
    await deps.onToolCall(Object.freeze(call));
  } catch {
    // a tracer outage must not deny or allow anything
  }
}

/**
 * SEC-1: why a file-tool call must not go ahead, or undefined when it may. The
 * built-in file tools run outside the OS sandbox and take any host path, so
 * every path the call names has to stay inside the task workspace. A check
 * that cannot finish (a bad task id, a malformed input, a symlink loop) is a
 * denial too.
 */
async function pathScopeReason(input: AgentRunInput, toolName: string, toolInput: unknown, deps: ClaudeAgentSdkDeps): Promise<string | undefined> {
  if (!PATH_SCOPED_TOOLS.includes(toolName)) return undefined;
  try {
    const outside = await pathOutsideWorkspace(taskWorkspace(deps.workspaceRoot, input.taskId), pathArgumentsOf(toolName, toolInput));
    return outside === null ? undefined : `Path "${outside}" is outside the task workspace`;
  } catch (error) {
    return `Path check failed (${error instanceof Error ? error.message : String(error)}); call denied`;
  }
}

/**
 * PreToolUse hook: records every call through `deps.audit` and denies tools
 * outside the role's allowed list, and file-tool paths outside the task
 * workspace (SEC-1). The kill switch and an audit failure deny too (fail
 * closed). The final decision then goes to `deps.onToolCall` (fail open).
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
    let reason = permitted ? await pathScopeReason(input, hookInput.tool_name, hookInput.tool_input, deps) : `Tool "${hookInput.tool_name}" is not allowed for role "${input.role}"`;
    try {
      if (deps.isKilled && (await deps.isKilled(input.companyId))) {
        reason = "Kill switch is active for this company; all agent actions are stopped";
      }
      await deps.audit(reason ? { ...entry, decision: "deny" } : entry);
    } catch (error) {
      reason = `Audit unavailable (${error instanceof Error ? error.message : String(error)}); call denied`;
    }
    await traceToolCall(deps, { ...entry, decision: reason === undefined ? "allow" : "deny", toolUseId: hookInput.tool_use_id, traceId: input.traceId ?? null, reason: reason ?? null });
    if (reason === undefined) return {};
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  };
}

const profileOf = (deps: ClaudeAgentSdkDeps): ModelProfile => deps.profile ?? DEFAULT_PROFILE;
const configRootOf = (deps: ClaudeAgentSdkDeps): string => deps.configRoot ?? defaultConfigRoot(deps.workspaceRoot);
const isMcpTool = (name: string): boolean => name.startsWith("mcp__");

/** The directories the engineering sandbox's filesystem rules are built from. */
export interface EngineeringSandboxPaths {
  /** Root of every company's agent config dir. */
  readonly configRoot: string;
  /** Root of every task workspace. */
  readonly workspaceRoot: string;
  /** This run's task workspace, `<workspaceRoot>/<taskId>`. */
  readonly workspace: string;
  /** This run's company config dir, `<configRoot>/<companyId>`. */
  readonly companyDir: string;
}

/**
 * SEC-1: engineering is the only role with a shell, so its commands run in the
 * OS sandbox. No unsandboxed retry, no start without the sandbox, and the npm
 * registry as the only network host a command may reach. The model gateway is
 * not listed: the Claude process calls it outside the sandbox (the sandbox
 * wraps shell commands only), and listing loopback would let a command reach it.
 *
 * Filesystem: the config root and the workspace root, which hold every company's
 * config, transcripts and task files, are unreadable, and only this run's task
 * workspace and company dir are re-allowed (`allowRead` wins over `denyRead`,
 * sdk.d.ts `sandbox.filesystem.allowRead`). The one writable place outside the
 * workspace is the company's npm cache. The company dir itself is NOT writable:
 * `<companyDir>/.claude/settings.json` is the subprocess's user settings, and
 * the SDK honours sandbox-loosening keys from user settings, so a command that
 * could write there could switch the sandbox off for the next run. Paths are
 * made absolute so the rules do not depend on the worker's cwd. Returns a fresh
 * object, with fresh lists, on every call.
 */
export function engineeringSandbox(paths: EngineeringSandboxPaths): NonNullable<Options["sandbox"]> {
  const companyDir = resolve(paths.companyDir);
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    network: { allowedDomains: ["registry.npmjs.org"] },
    filesystem: {
      denyRead: [resolve(paths.configRoot), resolve(paths.workspaceRoot)],
      allowRead: [resolve(paths.workspace), companyDir],
      allowWrite: [npmCacheDir(companyDir)],
    },
  };
}

/** This run's sandbox, from the host's roots and the run's own task and company. */
function sandboxFor(input: AgentRunInput, deps: ClaudeAgentSdkDeps): NonNullable<Options["sandbox"]> {
  const configRoot = configRootOf(deps);
  return engineeringSandbox({
    configRoot,
    workspaceRoot: deps.workspaceRoot,
    workspace: taskWorkspace(deps.workspaceRoot, input.taskId),
    companyDir: companyConfigDir(configRoot, input.companyId),
  });
}

/** This run's subprocess env: the base plus the company's config dir, and the gateway or (without one) the host key. */
function envFor(input: AgentRunInput, deps: ClaudeAgentSdkDeps): Record<string, string> {
  const base = deps.subprocessEnv ?? minimalSubprocessEnv(process.env);
  return {
    ...subprocessEnvFor(base, {
      companyId: input.companyId,
      configRoot: configRootOf(deps),
      ...(deps.gatewayBaseUrl !== undefined ? { gatewayBaseUrl: deps.gatewayBaseUrl } : {}),
      ...(deps.warn ? { warn: deps.warn } : {}),
    }),
  };
}

/** SEC-2: mirrors the transcript into North's session entries when the host wired them; flushed in batches. */
function sessionOptions(input: AgentRunInput, deps: ClaudeAgentSdkDeps): Pick<Options, "sessionStore" | "sessionStoreFlush"> {
  if (!deps.sessionEntries) return {};
  const store = createNorthSessionStore({ companyId: input.companyId, entries: deps.sessionEntries, ...(deps.warn ? { warn: deps.warn } : {}) });
  return { sessionStore: store, sessionStoreFlush: "batched" };
}

/** Pure builder for the Agent SDK `query()` options (ADR 0004). Does not touch the filesystem. */
export function buildQueryOptions(input: AgentRunInput, role: RoleDefinition, deps: ClaudeAgentSdkDeps): Options {
  const allowedTools = allowedToolsFor(role);
  const profile = profileOf(deps);
  const taskType = isTaskType(input.taskType) ? input.taskType : undefined;
  const { system } = buildTaskPrompt(input, role, input.vars ?? {});
  return {
    cwd: taskWorkspace(deps.workspaceRoot, input.taskId),
    env: envFor(input, deps),
    settingSources: [],
    settings: { disableSkillShellExecution: true },
    skills: [],
    permissionMode: "dontAsk",
    model: resolveModel(role.model, profile),
    effort: resolveEffort(role.model, profile),
    maxTurns: role.max_turns,
    maxBudgetUsd: role.max_budget_usd,
    tools: allowedTools.filter((name) => !isMcpTool(name)),
    allowedTools: [...allowedTools],
    disallowedTools: [...disallowedToolsFor(role)],
    mcpServers: { north: createSdkMcpServer({ name: "north", version: NORTH_SERVER_VERSION, tools: [memorySearchTool(input, deps)] }) },
    outputFormat: { type: "json_schema", schema: taskType ? outputJsonSchema(taskType) : input.outputSchema },
    hooks: { PreToolUse: [{ hooks: [auditHook(input, allowedTools, deps)] }] },
    systemPrompt: system,
    ...(role.role === ENGINEERING_ROLE ? { sandbox: sandboxFor(input, deps) } : {}),
    ...sessionOptions(input, deps),
    ...(input.resume ? { resume: input.resume.sessionId } : {}),
  };
}

const zeroUsage = (model: string): AgentRunUsage =>
  Object.freeze({ model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, durationMs: 0 });

const failed = (error: string, sessionId: string | null, usage: AgentRunUsage): AgentRunResult =>
  Object.freeze({ status: "failed", error, sessionId, usage });

/**
 * Maps the SDK's per-model usage onto North's flat usage record.
 * `inputTokens` counts cache reads and writes too (as it always has); the two
 * cache fields break them out so a caller can price them at their own rate.
 */
export function usageOf(result: SDKResultMessage, model: string): AgentRunUsage {
  const models = Object.values(result.modelUsage ?? {});
  const total = (pick: (m: (typeof models)[number]) => number): number => models.reduce((sum, m) => sum + pick(m), 0);
  return Object.freeze({
    model,
    inputTokens: total((m) => m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens),
    outputTokens: total((m) => m.outputTokens),
    cacheReadTokens: total((m) => m.cacheReadInputTokens),
    cacheWriteTokens: total((m) => m.cacheCreationInputTokens),
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

/**
 * Production adapter over `query()` from `@anthropic-ai/claude-agent-sdk`
 * (ADR 0004). Every result carries `sandboxMinutes`, the wall time from the
 * start of the subprocess stream to its end or failure (0 when refused
 * before it), and the input's `traceId`.
 */
export class ClaudeAgentSdkRuntime implements AgentRuntime {
  readonly name = "claude-agent-sdk" as const;

  constructor(private readonly deps: ClaudeAgentSdkDeps) {}

  private now(): number {
    return (this.deps.monotonicMs ?? (() => performance.now()))();
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const role = this.deps.roles.get(input.role);
    if (!role) return withRunMeta(failed(`Unknown role "${input.role}"`, null, zeroUsage("unknown")), input, 0);
    if (!isTaskType(input.taskType)) return withRunMeta(failed(`Unknown task type "${input.taskType}"`, null, zeroUsage(resolveModel(role.model, profileOf(this.deps)))), input, 0);
    const started = this.now();
    const result = await this.stream(input, role, input.taskType);
    return withRunMeta(result, input, elapsedMinutes(this.now() - started));
  }

  private async stream(input: AgentRunInput, role: RoleDefinition, taskType: TaskType): Promise<AgentRunResult> {
    const model = resolveModel(role.model, profileOf(this.deps));
    try {
      // both paths are checked before anything is created: a crafted company or task id fails the run first
      const companyDir = companyConfigDir(configRootOf(this.deps), input.companyId);
      const workspace = taskWorkspace(this.deps.workspaceRoot, input.taskId);
      await mkdir(companyDir, { recursive: true, mode: 0o700 });
      await mkdir(npmCacheDir(companyDir), { recursive: true, mode: 0o700 }); // the sandbox can only bind a path that exists
      await mkdir(workspace, { recursive: true });
      const options = buildQueryOptions(input, role, this.deps);
      const { user } = buildTaskPrompt(input, role, input.vars ?? {});
      let last: SDKResultMessage | undefined;
      for await (const message of query({ prompt: user, options })) {
        if (message.type === "result") last = message;
      }
      if (!last) return failed("Agent SDK stream ended without a result message", null, zeroUsage(model));
      return mapResult(last, taskType, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failed(`Agent SDK run failed: ${message}`, input.resume?.sessionId ?? null, zeroUsage(model));
    }
  }
}
