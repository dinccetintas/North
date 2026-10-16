import { createServiceClient, getKillSwitch, searchMemory, type DbClient } from "@north/db";
import { loadRoles, minimalSubprocessEnv, MOCK_LLM_RESPONSES, selectLlm, selectRuntime, type AgentRuntime, type LlmClient, type RoleDefinition } from "@north/agents";
import { selectIntegrations, type Integrations } from "@north/integrations";
import { workerEnv, type WorkerEnv } from "./env";
import { createTracer, type Tracer } from "./observability";
import { SimClock, wallClock, type Clock } from "./services/clock";
import { withPinnedCompetitorFetch } from "./services/pinned-fetch";
import { hostIsPrivate, type VerifierConfig } from "./services/verifier";

/** Everything a worker function needs; built once per process, injectable in tests. */
export interface WorkerDeps {
  readonly env: WorkerEnv;
  readonly db: DbClient;
  readonly roles: ReadonlyMap<string, RoleDefinition>;
  readonly runtime: AgentRuntime;
  readonly integrations: Integrations;
  readonly verifier: VerifierConfig;
  /** The worker's one clock (ADR 0011): wall time in live mode, the simulated clock in sandbox mode. */
  readonly clock: Clock;
  /** The simulated clock behind `clock` in sandbox mode (the `/sandbox/clock` route moves it); null in live mode. */
  readonly simClock: SimClock | null;
  /** Single-call structured model client (signal scoring); `MockLlm` with the sandbox fixtures unless the SDK runtime and a key are configured. */
  readonly llm: LlmClient;
  /** OBS-1 (M6): one Langfuse trace per agent run; `NO_TRACER` without the three keys. */
  readonly tracer: Tracer;
}

/** Audit payloads are capped so a hostile tool input cannot bloat the log. */
export const AUDIT_INPUT_MAX_CHARS = 4000;

export function capAuditInput(input: unknown): { readonly json: string; readonly truncated: boolean } {
  let json: string;
  try {
    json = JSON.stringify(input ?? {}) ?? "{}";
  } catch {
    json = JSON.stringify({ unserializable: true });
  }
  return json.length > AUDIT_INPUT_MAX_CHARS ? { json: json.slice(0, AUDIT_INPUT_MAX_CHARS), truncated: true } : { json, truncated: false };
}

let cached: Promise<WorkerDeps> | null = null;

export function buildDeps(env: WorkerEnv = workerEnv()): Promise<WorkerDeps> {
  if (!cached) cached = createDeps(env);
  return cached;
}

/** Sandbox mode runs on a movable clock (seeded from `NORTH_CLOCK_START`); live mode on the wall clock only. */
function clockFor(env: WorkerEnv): { readonly clock: Clock; readonly simClock: SimClock | null } {
  if (env.INTEGRATIONS_MODE !== "sandbox") return { clock: wallClock, simClock: null };
  const simClock = new SimClock(env.NORTH_CLOCK_START);
  return { clock: () => simClock.now(), simClock };
}

/** The verifier's host policy for the competitor-site source (B5): no private or loopback hosts, ever. */
const allowPublicUrl = async (url: string): Promise<boolean> => {
  try {
    return !(await hostIsPrivate(new URL(url).hostname));
  } catch {
    return false;
  }
};

async function createDeps(env: WorkerEnv): Promise<WorkerDeps> {
  const db = createServiceClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const roles = await loadRoles(env.AGENTS_DIR);
  const siteBaseUrl = process.env.SANDBOX_SITE_BASE_URL ?? `http://127.0.0.1:${env.WORKER_PORT}`;
  const { clock, simClock } = clockFor(env);
  // D6-11: the competitor source fetches through the pinned fetch (resolve once, vet, connect to that address only).
  const integrations = withPinnedCompetitorFetch(
    selectIntegrations({ ...process.env, INTEGRATIONS_MODE: env.INTEGRATIONS_MODE, SANDBOX_ROOT: env.SANDBOX_ROOT, SANDBOX_SITE_BASE_URL: siteBaseUrl }, undefined, undefined, { allowUrl: allowPublicUrl, clock }),
    allowPublicUrl,
  );
  // Sandbox previews live on the worker itself (loopback); live previews must be public hosts (M3 security review M3).
  const verifier: VerifierConfig = env.INTEGRATIONS_MODE === "sandbox" ? { timeoutMs: 10_000, allowedOrigins: [new URL(siteBaseUrl).origin], allowPrivate: true } : { timeoutMs: 10_000, allowPrivate: false };
  const tracer = createTracer(env);
  const runtime = selectRuntime(
    {
      roles,
      onToolCall: (call) => tracer.toolCall(call),
      workspaceRoot: env.WORKSPACE_ROOT,
      subprocessEnv: minimalSubprocessEnv(process.env),
      memorySearch: async (companyId, query) => searchMemory(db, companyId, query),
      isKilled: async (companyId) => getKillSwitch(db, companyId),
      audit: async (entry) => {
        const capped = capAuditInput(entry.input);
        const { error } = await db.from("audit_tool_calls").insert({
          company_id: entry.companyId,
          task_id: entry.taskId,
          tool_name: entry.toolName,
          input: { value: JSON.parse(capped.json), truncated: capped.truncated },
          decision: entry.decision,
        });
        if (error) throw new Error(`audit insert failed: ${error.message}`);
      },
    },
    { AGENT_RUNTIME: env.AGENT_RUNTIME },
  );
  const llm = selectLlm({ AGENT_RUNTIME: env.AGENT_RUNTIME, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }, { ...MOCK_LLM_RESPONSES });
  return Object.freeze({ env, db, roles, runtime, integrations, verifier, clock, simClock, llm, tracer });
}
