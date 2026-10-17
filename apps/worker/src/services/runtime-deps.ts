// SEC-1 / TST-1: the worker's model plumbing, assembled once per process. With
// the Agent SDK runtime the loopback model gateway starts first and holds the
// only copy of the real key; the agent subprocess (gateway URL, placeholder
// key) and the single-call LLM client are both pointed at it, so every model
// call of the process is capped, and recorded or replayed, in one place. The
// mock runtime starts nothing and keeps the mock LLM.
import { resolve } from "node:path";
import { GATEWAY_PLACEHOLDER_KEY, LIVE_RUNTIME, minimalSubprocessEnv, MOCK_LLM_RESPONSES, selectLlm, selectRuntime, type AgentRuntime, type ClaudeAgentSdkDeps, type LlmClient, type RoleDefinition } from "@north/agents";
import { getKillSwitch, searchMemoryHybrid, type DbClient } from "@north/db";
import type { WorkerEnv } from "../env";
import { GatewayBudget } from "../gateway/budget";
import { startGateway, type Gateway, type GatewayMode, type GatewayOptions, type GatewayStats } from "../gateway/server";
import type { Tracer } from "../observability";
import { auditToolCall } from "./audit";
import type { Clock } from "./clock";
import type { Embedder } from "./embedder";
import { dbSessionRepo, sessionEntriesPort } from "./session-port";

/** The model API the gateway forwards to unless `ANTHROPIC_BASE_URL` names another (loopback only in production). */
export const DEFAULT_MODEL_UPSTREAM = "https://api.anthropic.com";

/** The running gateway as the worker holds it: never the key, only where it listens, its mode, its numbers and how to stop it. */
export interface WorkerGateway {
  readonly baseUrl: string;
  readonly mode: GatewayMode;
  stats(): GatewayStats;
  /** Stops listening and cuts every exchange in flight. */
  close(): Promise<void>;
}

/** What `buildRuntimeDeps` assembles. */
export interface RuntimeDeps {
  readonly runtime: AgentRuntime;
  /** Null with the mock runtime. */
  readonly gateway: WorkerGateway | null;
  readonly llm: LlmClient;
}

/** What `buildRuntimeDeps` needs besides the env, the db, the tracer and the logger, plus seams for tests. */
export interface RuntimeDepsOptions {
  readonly roles: ReadonlyMap<string, RoleDefinition>;
  /** The worker clock: the gateway's UTC day follows it. */
  readonly clock: Clock;
  /** Embeds memory queries for hybrid search. */
  readonly embedder: Embedder;
  /** The host environment the subprocess base env is cut from; defaults to `process.env`. */
  readonly hostEnv?: NodeJS.ProcessEnv;
  readonly startGateway?: (options: GatewayOptions) => Promise<Gateway>;
  readonly selectRuntime?: typeof selectRuntime;
  readonly selectLlm?: typeof selectLlm;
}

type Log = (message: string) => void;

/** The env's cassette mode as the gateway names it: `off` forwards and stores nothing, which is the gateway's `live`. */
export const gatewayModeOf = (mode: WorkerEnv["NORTH_CASSETTE_MODE"]): GatewayMode => (mode === "off" ? "live" : mode);

/** Starts the gateway: the real key is read here, once, and handed to it alone; a replaying gateway never calls the model API, so it gets none (least privilege). */
async function startWorkerGateway(env: WorkerEnv, log: Log, options: RuntimeDepsOptions): Promise<WorkerGateway> {
  const mode = gatewayModeOf(env.NORTH_CASSETTE_MODE);
  const gateway = await (options.startGateway ?? startGateway)({
    apiKey: mode === "replay" ? null : (env.ANTHROPIC_API_KEY ?? null),
    upstream: env.ANTHROPIC_BASE_URL ?? DEFAULT_MODEL_UPSTREAM,
    mode,
    cassetteDir: env.NORTH_CASSETTE_DIR,
    budget: new GatewayBudget(env.NORTH_DAILY_CAP_USD, options.clock),
    log,
  });
  return Object.freeze({ baseUrl: gateway.baseUrl, mode, stats: () => gateway.stats(), close: () => gateway.close() });
}

/**
 * The Agent SDK runtime's deps: the gateway, the model profile, the per-company
 * config root, the session store port, the sandbox's extra unreadable paths
 * (the worker's cwd and the repo root, where `.env` lives) and a subprocess
 * base env cut to the allow-list, so no key of the host reaches it.
 */
function agentDeps(env: WorkerEnv, db: DbClient, tracer: Tracer, log: Log, options: RuntimeDepsOptions, gateway: WorkerGateway | null): ClaudeAgentSdkDeps {
  const { embedder } = options;
  return {
    roles: options.roles,
    onToolCall: (call) => tracer.toolCall(call),
    workspaceRoot: env.WORKSPACE_ROOT,
    subprocessEnv: minimalSubprocessEnv(options.hostEnv ?? process.env),
    memorySearch: async (companyId, query) => searchMemoryHybrid(db, companyId, query, await embedder.embed(query)),
    isKilled: async (companyId) => getKillSwitch(db, companyId),
    audit: auditToolCall(db),
    profile: env.NORTH_MODEL_PROFILE,
    configRoot: env.AGENT_CONFIG_ROOT,
    sessionEntries: sessionEntriesPort(dbSessionRepo(db)),
    sandboxDenyRead: [process.cwd(), resolve(env.AGENTS_DIR, "..")],
    warn: log,
    ...(gateway ? { gatewayBaseUrl: gateway.baseUrl } : {}),
  };
}

/** The single-call LLM: through the gateway with the placeholder key when one runs, the mock otherwise (never a live client without a gateway). */
function llmFor(env: WorkerEnv, gateway: WorkerGateway | null, options: RuntimeDepsOptions): LlmClient {
  const select = options.selectLlm ?? selectLlm;
  if (gateway === null) return select({ AGENT_RUNTIME: env.AGENT_RUNTIME }, { ...MOCK_LLM_RESPONSES });
  return select({ AGENT_RUNTIME: env.AGENT_RUNTIME, ANTHROPIC_API_KEY: GATEWAY_PLACEHOLDER_KEY }, { ...MOCK_LLM_RESPONSES }, { baseURL: gateway.baseUrl, apiKey: GATEWAY_PLACEHOLDER_KEY, profile: env.NORTH_MODEL_PROFILE });
}

/** Closes a gateway during a failed assembly: a close that fails is logged, so the assembly's own error is the one that surfaces. */
async function closeQuietly(gateway: WorkerGateway | null, log: Log): Promise<void> {
  try {
    await gateway?.close();
  } catch (error) {
    log(`gateway: close after a failed start-up failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Builds the agent runtime, the model gateway and the single-call LLM client.
 * `AGENT_RUNTIME=claude-agent-sdk` starts the gateway (live, record or replay
 * per `NORTH_CASSETTE_MODE`, capped by `NORTH_DAILY_CAP_USD` per UTC day of the
 * worker clock) and points the runtime and the LLM at it; a failure after it
 * started closes it again. The mock runtime starts nothing.
 */
export async function buildRuntimeDeps(env: WorkerEnv, db: DbClient, tracer: Tracer, log: Log, options: RuntimeDepsOptions): Promise<RuntimeDeps> {
  const gateway = env.AGENT_RUNTIME === LIVE_RUNTIME ? await startWorkerGateway(env, log, options) : null;
  try {
    const runtime = (options.selectRuntime ?? selectRuntime)(agentDeps(env, db, tracer, log, options, gateway), { AGENT_RUNTIME: env.AGENT_RUNTIME });
    return Object.freeze({ runtime, gateway, llm: llmFor(env, gateway, options) });
  } catch (error) {
    await closeQuietly(gateway, log);
    throw error;
  }
}
