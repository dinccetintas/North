import { createServiceClient, type DbClient } from "@north/db";
import { loadRoles, type AgentRuntime, type LlmClient, type RoleDefinition } from "@north/agents";
import type { FencePolicy, ModelProfile } from "@north/core";
import { selectIntegrations, type Integrations } from "@north/integrations";
import { fencePolicyFor, workerEnv, type WorkerEnv } from "./env";
import { createTracer, type Tracer } from "./observability";
import { SimClock, wallClock, type Clock } from "./services/clock";
import { edgeFunctionEmbedder, nullEmbedder, type Embedder } from "./services/embedder";
import { withPinnedCompetitorFetch } from "./services/pinned-fetch";
import { buildRuntimeDeps, type WorkerGateway } from "./services/runtime-deps";
import { hostIsPrivate, type VerifierConfig } from "./services/verifier";

export { AUDIT_INPUT_MAX_CHARS, auditInput, capAuditInput } from "./services/audit";

/** The worker env as the deps carry it: everything but the model key, which only the gateway holds (SEC-1). */
export type DepsEnv = Omit<WorkerEnv, "ANTHROPIC_API_KEY">;

/** Everything a worker function needs; built once per process, injectable in tests. */
export interface WorkerDeps {
  readonly env: DepsEnv;
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
  /** TST-1: the profile model aliases resolve on (`NORTH_MODEL_PROFILE`). */
  readonly profile: ModelProfile;
  /** TST-5: the test-account fence (`NORTH_TEST_FENCE` and its lists); disabled outside staging. */
  readonly fence: FencePolicy;
  /** SEC-1: the loopback model gateway, started with the Agent SDK runtime; null with the mock runtime. */
  readonly gateway: WorkerGateway | null;
  /** LRN-7: embeds memory queries for hybrid search; `nullEmbedder` in sandbox unless `NORTH_EMBED_QUERIES=1`. */
  readonly embedder: Embedder;
}

let cached: Promise<WorkerDeps> | null = null;

/** The process's deps, built once (the gateway, when it runs, starts here) and shared by every caller. */
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

/** The worker's one-line warnings (gateway, embedder, session store), on stderr. */
const workerLog = (message: string): void => console.warn(`[north-worker] ${message}`);

/** LRN-7: queries are embedded through the Edge Function in live mode, and in sandbox mode only with `NORTH_EMBED_QUERIES=1`. */
function embedderFor(env: WorkerEnv): Embedder {
  if (env.INTEGRATIONS_MODE !== "live" && env.NORTH_EMBED_QUERIES !== "1") return nullEmbedder;
  return edgeFunctionEmbedder({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, warn: workerLog });
}

/** SEC-1: the env without the model key, as `WorkerDeps.env` carries it: `ANTHROPIC_API_KEY` is handed to the gateway and kept out of the deps. A new frozen object. */
export function depsEnvOf(env: WorkerEnv): DepsEnv {
  const copy: Partial<WorkerEnv> = { ...env };
  delete copy.ANTHROPIC_API_KEY;
  return Object.freeze(copy as DepsEnv);
}

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
  const embedder = embedderFor(env);
  // SEC-1: with the Agent SDK runtime the gateway starts here and is the only holder of the model key.
  const { runtime, gateway, llm } = await buildRuntimeDeps(env, db, tracer, workerLog, { roles, clock, embedder });
  const fence = fencePolicyFor(env);
  return Object.freeze({ env: depsEnvOf(env), db, roles, runtime, integrations, verifier, clock, simClock, llm, tracer, profile: env.NORTH_MODEL_PROFILE, fence, gateway, embedder });
}
