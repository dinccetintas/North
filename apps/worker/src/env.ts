import { resolve } from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  AGENT_RUNTIME: z.enum(["mock", "claude-agent-sdk"]).default("mock"),
  INTEGRATIONS_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  WORKER_PORT: z.coerce.number().int().positive().default(3101),
  WORKSPACE_ROOT: z.string().default(resolve(process.cwd(), ".workspaces")),
  AGENTS_DIR: z.string().default(resolve(process.cwd(), "../../agents")),
});
export type WorkerEnv = z.infer<typeof EnvSchema>;

/** Validated worker environment; fails fast with the missing keys named. */
export function workerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Worker env invalid: ${missing}`);
  }
  return parsed.data;
}
