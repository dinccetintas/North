import { resolve } from "node:path";
import { z } from "zod";

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
    AGENT_RUNTIME: z.enum(["mock", "claude-agent-sdk"]).default("mock"),
    INTEGRATIONS_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    WORKER_PORT: z.coerce.number().int().positive().default(3101),
    /** Loopback by default; set 0.0.0.0 only behind a trusted network boundary. */
    WORKER_HOST: z.string().default("127.0.0.1"),
    /** Required in production so only Inngest can invoke the serve endpoint. */
    INNGEST_SIGNING_KEY: z.string().min(10).optional(),
    WORKSPACE_ROOT: z.string().default(resolve(process.cwd(), ".workspaces")),
    /** Sandbox repos and sites (served at /sandbox/sites in sandbox mode). */
    SANDBOX_ROOT: z.string().default(resolve(process.cwd(), ".sandbox")),
    /** AES-256-GCM key for connection tokens (ADR 0008); required only in live mode. */
    CONNECTIONS_ENCRYPTION_KEY: z.string().optional(),
    AGENTS_DIR: z.string().default(resolve(process.cwd(), "../../agents")),
  })
  .refine((env) => env.NODE_ENV !== "production" || Boolean(env.INNGEST_SIGNING_KEY), {
    message: "INNGEST_SIGNING_KEY is required in production",
    path: ["INNGEST_SIGNING_KEY"],
  })
  .refine((env) => env.INTEGRATIONS_MODE !== "live" || Boolean(env.CONNECTIONS_ENCRYPTION_KEY), {
    message: "CONNECTIONS_ENCRYPTION_KEY is required when INTEGRATIONS_MODE=live",
    path: ["CONNECTIONS_ENCRYPTION_KEY"],
  });
export type WorkerEnv = z.infer<typeof EnvSchema>;

/** Validated worker environment; fails fast with the missing keys named. */
export function workerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Worker env invalid: ${missing}`);
  }
  return parsed.data;
}
