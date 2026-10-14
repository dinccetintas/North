import { createServiceClient, getKillSwitch, searchMemory, type DbClient } from "@north/db";
import { loadRoles, minimalSubprocessEnv, selectRuntime, type AgentRuntime, type RoleDefinition } from "@north/agents";
import { workerEnv, type WorkerEnv } from "./env";

/** Everything a worker function needs; built once per process, injectable in tests. */
export interface WorkerDeps {
  readonly env: WorkerEnv;
  readonly db: DbClient;
  readonly roles: ReadonlyMap<string, RoleDefinition>;
  readonly runtime: AgentRuntime;
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

async function createDeps(env: WorkerEnv): Promise<WorkerDeps> {
  const db = createServiceClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const roles = await loadRoles(env.AGENTS_DIR);
  const runtime = selectRuntime(
    {
      roles,
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
  return Object.freeze({ env, db, roles, runtime });
}
