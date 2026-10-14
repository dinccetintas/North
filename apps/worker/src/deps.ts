import { createServiceClient, searchMemory, type DbClient } from "@north/db";
import { loadRoles, selectRuntime, type AgentRuntime, type RoleDefinition } from "@north/agents";
import { workerEnv, type WorkerEnv } from "./env";

/** Everything a worker function needs; built once per process, injectable in tests. */
export interface WorkerDeps {
  readonly env: WorkerEnv;
  readonly db: DbClient;
  readonly roles: ReadonlyMap<string, RoleDefinition>;
  readonly runtime: AgentRuntime;
}

let cached: Promise<WorkerDeps> | null = null;

export function buildDeps(env: WorkerEnv = workerEnv()): Promise<WorkerDeps> {
  if (!cached) cached = createDeps(env);
  return cached;
}

async function createDeps(env: WorkerEnv): Promise<WorkerDeps> {
  const db = createServiceClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const roles = await loadRoles(env.AGENTS_DIR);
  const runtime = selectRuntime(
    {
      roles,
      workspaceRoot: env.WORKSPACE_ROOT,
      memorySearch: async (companyId, query) => searchMemory(db, companyId, query),
      audit: async (entry) => {
        await db.from("audit_tool_calls").insert({
          company_id: entry.companyId,
          tool_name: entry.toolName,
          input: JSON.parse(JSON.stringify(entry.input ?? {})),
          decision: entry.decision,
        });
      },
    },
    { AGENT_RUNTIME: env.AGENT_RUNTIME, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  );
  return Object.freeze({ env, db, roles, runtime });
}
