import { resolve } from "node:path";
import { z } from "zod";
import { SANDBOX_STRIPE_WEBHOOK_SECRET } from "@north/integrations";
import { isLoopbackHost } from "./host";

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
    /** North's own OAuth apps (ADR 0010): they name the application, never an account. All optional; without them the settings page offers "Connect (sandbox)". */
    META_APP_ID: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    AGENTS_DIR: z.string().default(resolve(process.cwd(), "../../agents")),
    /** The Sentry internal integration's client secret: the issue webhook is signed with it (PRO-2, ADR 0013). Sandbox mode on a loopback host defaults it; otherwise the route is mounted only when set. */
    SENTRY_CLIENT_SECRET: z.string().min(8).optional(),
    /** The worker's own Sentry project (OBS-1); `@sentry/node` initialises only when set. */
    SENTRY_DSN: z.string().url().optional(),
    /** The dev worker's initial simulated instant (ISO, sandbox only): the harness moves it further through `POST /sandbox/clock`. */
    NORTH_CLOCK_START: z.iso.datetime({ offset: true }).optional(),
    /** BIL-1 (ADR 0014): the platform's Stripe key; read by `@north/integrations` (`stripeBillingConfig`). Without it billing stays sandbox. */
    STRIPE_SECRET_KEY: z.string().min(10).optional(),
    /** BIL-1: the Stripe webhook endpoint secret `POST /webhooks/stripe` verifies against. Sandbox mode on a loopback host defaults it; otherwise the route is mounted only when set. */
    STRIPE_WEBHOOK_SECRET: z.string().min(8).optional(),
    /** OUT-2: North's Stripe Connect application (the user's own Stripe read). Optional; without both the connection is not configured. */
    STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
    STRIPE_CONNECT_CLIENT_SECRET: z.string().optional(),
    /** OBS-1 (M6): Langfuse traces per agent run; on only when all three are set. */
    LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
    LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
    LANGFUSE_HOST: z.string().url().optional(),
    /** `1` (default): prompts and tool inputs never leave the worker; `0` sends them to Langfuse. */
    LANGFUSE_REDACT: z.enum(["0", "1"]).default("1"),
    /** RET-1 (ADR 0016): `1` lets `retention-sweep` purge owners past `retention_until`; `0` (default) only archives and marks `purge_due` (`scripts/purge-due.ts` purges on request). */
    RETENTION_PURGE_ENABLED: z.enum(["0", "1"]).default("0"),
  })
  .refine((env) => env.NODE_ENV !== "production" || Boolean(env.INNGEST_SIGNING_KEY), {
    message: "INNGEST_SIGNING_KEY is required in production",
    path: ["INNGEST_SIGNING_KEY"],
  })
  .refine((env) => env.INTEGRATIONS_MODE !== "live" || Boolean(env.CONNECTIONS_ENCRYPTION_KEY), {
    message: "CONNECTIONS_ENCRYPTION_KEY is required when INTEGRATIONS_MODE=live",
    path: ["CONNECTIONS_ENCRYPTION_KEY"],
  })
  .refine((env) => env.INTEGRATIONS_MODE === "sandbox" || env.NORTH_CLOCK_START === undefined, {
    message: "NORTH_CLOCK_START is a sandbox-only setting; the live worker runs on the wall clock",
    path: ["NORTH_CLOCK_START"],
  });
export type WorkerEnv = z.infer<typeof EnvSchema>;

/** The secret the smoke and the e2e sign Sentry webhooks with when no real one is configured (sandbox only). */
export const SANDBOX_SENTRY_SECRET = "sandbox-sentry-secret";

export type SentryEnv = Pick<WorkerEnv, "SENTRY_CLIENT_SECRET" | "INTEGRATIONS_MODE" | "WORKER_HOST">;

/**
 * The secret `POST /webhooks/sentry` verifies against, or null when the route
 * must not be mounted: live mode without a secret, or sandbox mode on a host
 * that is not loopback (the public default secret would otherwise accept
 * forged issues from anywhere, M5 review M1).
 */
export function sentrySecretFor(env: SentryEnv): string | null {
  if (env.SENTRY_CLIENT_SECRET) return env.SENTRY_CLIENT_SECRET;
  return env.INTEGRATIONS_MODE === "sandbox" && isLoopbackHost(env.WORKER_HOST) ? SANDBOX_SENTRY_SECRET : null;
}

/** The boot line's word for the webhook. */
export const sentryWebhookLabel = (env: SentryEnv): string => (sentrySecretFor(env) ? "webhook on" : "webhook off (no secret)");

export type StripeEnv = Pick<WorkerEnv, "STRIPE_WEBHOOK_SECRET" | "INTEGRATIONS_MODE" | "WORKER_HOST">;

/**
 * The secret `POST /webhooks/stripe` verifies against, or null when the route
 * must not be mounted (BIL-1, the `sentrySecretFor` rule): live mode without
 * `STRIPE_WEBHOOK_SECRET`, or sandbox mode off loopback, where the public
 * sandbox secret would let anyone forge an entitlement.
 */
export function stripeSecretFor(env: StripeEnv): string | null {
  if (env.STRIPE_WEBHOOK_SECRET) return env.STRIPE_WEBHOOK_SECRET;
  return env.INTEGRATIONS_MODE === "sandbox" && isLoopbackHost(env.WORKER_HOST) ? SANDBOX_STRIPE_WEBHOOK_SECRET : null;
}

export const stripeWebhookLabel = (env: StripeEnv): string => (stripeSecretFor(env) ? "webhook on" : "webhook off (no secret)");

/** OBS-1: Langfuse needs all three keys; anything less is a no-op tracer. */
export const langfuseConfigured = (env: Pick<WorkerEnv, "LANGFUSE_PUBLIC_KEY" | "LANGFUSE_SECRET_KEY" | "LANGFUSE_HOST">): boolean => Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY && env.LANGFUSE_HOST);

/** Validated worker environment; fails fast with the missing keys named. */
export function workerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Worker env invalid: ${missing}`);
  }
  return parsed.data;
}
