import { resolve } from "node:path";
import { z } from "zod";
import { fencePolicyFromEnv, metaAdAccountId, MODEL_PROFILES, type FencePolicy } from "@north/core";
import { SANDBOX_STRIPE_WEBHOOK_SECRET } from "@north/integrations";
import { isLoopbackHost, isLoopbackUrl, selfBaseUrl } from "./host";

/** An empty value (`KEY=` in a .env file, as `.env.example` ships `ANTHROPIC_API_KEY`) counts as unset. */
const blankAsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema);

/** The non-empty entries of a comma-separated list, trimmed (the split `fencePolicyFromEnv` makes). */
const entriesOf = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

/** TST-5: a comma-separated fence allow-list whose every entry must look like `what`, so a typo (a space or `;` as separator, an `@`) fails boot instead of silently fencing the wrong accounts. */
const fenceList = (pattern: RegExp, what: string) =>
  blankAsUnset(z.string().optional().refine((value) => value === undefined || entriesOf(value).every((entry) => pattern.test(entry)), { message: `every comma-separated entry must be ${what}` }));

/** Meta ad account ids (`act_123` or `123`), GitHub logins, mail domains (at least one dot), Vercel project name prefixes. */
const META_AD_ACCOUNT = /^(act_)?\d+$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAIL_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const VERCEL_PREFIX = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** M7 (SEC-1, TST-1, TST-2, TST-5, STG-1, CMP-1, LRN-7): the gateway, the model profile, the fence and the query embedder. */
const M7Keys = {
  /** STG-1: which deployment this is. Only `staging` may run the fence, cassettes or a cheaper model profile under NODE_ENV=production. */
  NORTH_ENV: z.enum(["production", "staging"]).default("production"),
  /** TST-1: the profile model aliases resolve on; under NODE_ENV=production anything but `production` needs NORTH_ENV=staging. */
  NORTH_MODEL_PROFILE: z.enum(MODEL_PROFILES).default("production"),
  /** TST-5: `1` turns the test-account fence on (default deny outside the lists below); exactly `0` or `1`. */
  NORTH_TEST_FENCE: z.enum(["0", "1"]).default("0"),
  /** TST-5: comma-separated allow-lists of the fence; a malformed entry fails boot. */
  NORTH_FENCE_META_AD_ACCOUNTS: fenceList(META_AD_ACCOUNT, "a Meta ad account id (act_123 or 123)"),
  NORTH_FENCE_GITHUB_OWNERS: fenceList(GITHUB_LOGIN, "a GitHub login"),
  NORTH_FENCE_RECIPIENT_DOMAINS: fenceList(MAIL_DOMAIN, "a mail domain such as resend.app"),
  /** TST-5: the Vercel project prefix the fence allows (default `e2e-`). */
  NORTH_FENCE_VERCEL_PREFIX: blankAsUnset(z.string().trim().regex(VERCEL_PREFIX, { message: "must be a Vercel project name prefix (lowercase letters, digits, . _ -)" }).optional()),
  /** TST-2: `off` (the gateway's `live`), `record` or `replay`. */
  NORTH_CASSETTE_MODE: z.enum(["off", "record", "replay"]).default("off"),
  /** TST-2: where cassettes live; default `<repo root>/cassettes`, a relative path is read from the repo root (`AGENTS_DIR/..`). */
  NORTH_CASSETTE_DIR: blankAsUnset(z.string().optional()),
  /** TST-1: the gateway's spend cap per UTC day in USD; 0 (default) is no cap. */
  NORTH_DAILY_CAP_USD: z.coerce.number().min(0).default(0),
  /** SEC-2: root of the per-company agent config dirs (HOME of each run); default `<cwd>/.agent-config`, on Fly `/data/agent-config`. Always made absolute (see the transform): a relative HOME would land in the task workspace. */
  AGENT_CONFIG_ROOT: blankAsUnset(z.string().optional()),
  /** CMP-1: the public worker URL unsubscribe links point at; sandbox mode defaults it to the worker's own URL, live mode in production requires it. */
  NORTH_WORKER_PUBLIC_URL: blankAsUnset(z.url().optional()),
  /** CMP-1: the key unsubscribe tokens are signed with; see `unsubscribeSecretFor`. */
  UNSUBSCRIBE_SECRET: blankAsUnset(z.string().min(16).optional()),
  /** LRN-7: `1` embeds memory queries through the `embed` Edge Function in sandbox mode too (live mode always does). */
  NORTH_EMBED_QUERIES: z.enum(["0", "1"]).default("0"),
  /** SEC-1: the model API the gateway forwards to (default https://api.anthropic.com); loopback only in production. */
  ANTHROPIC_BASE_URL: blankAsUnset(z.url().optional()),
  /** SEC-1: the real model key. Read once, by the gateway's start-up; never handed to an agent subprocess. */
  ANTHROPIC_API_KEY: blankAsUnset(z.string().min(10).optional()),
};

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
    ...M7Keys,
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
  })
  .refine((env) => env.NODE_ENV !== "production" || env.NORTH_TEST_FENCE === "0" || env.NORTH_ENV === "staging", {
    message: "NORTH_TEST_FENCE=1 is for staging: set NORTH_ENV=staging, or turn the fence off",
    path: ["NORTH_TEST_FENCE"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.NORTH_CASSETTE_MODE === "off" || env.NORTH_ENV === "staging", {
    message: "NORTH_CASSETTE_MODE must be off in production unless NORTH_ENV=staging",
    path: ["NORTH_CASSETTE_MODE"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.NORTH_ENV !== "production" || env.NORTH_MODEL_PROFILE === "production", {
    message: "NORTH_MODEL_PROFILE must be production under NODE_ENV=production unless NORTH_ENV=staging",
    path: ["NORTH_MODEL_PROFILE"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.ANTHROPIC_BASE_URL === undefined || isLoopbackUrl(env.ANTHROPIC_BASE_URL), {
    message: "ANTHROPIC_BASE_URL must be a loopback URL in production (the real key goes to api.anthropic.com or this machine only)",
    path: ["ANTHROPIC_BASE_URL"],
  })
  .refine((env) => env.AGENT_RUNTIME !== "claude-agent-sdk" || env.NORTH_CASSETTE_MODE === "replay" || env.ANTHROPIC_API_KEY !== undefined, {
    message: "ANTHROPIC_API_KEY is required when AGENT_RUNTIME=claude-agent-sdk (only NORTH_CASSETTE_MODE=replay runs without it)",
    path: ["ANTHROPIC_API_KEY"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.INTEGRATIONS_MODE === "sandbox" || env.NORTH_WORKER_PUBLIC_URL !== undefined, {
    message: "NORTH_WORKER_PUBLIC_URL is required when INTEGRATIONS_MODE=live in production (unsubscribe links point at it)",
    path: ["NORTH_WORKER_PUBLIC_URL"],
  })
  .transform((env) => ({
    ...env,
    NORTH_CASSETTE_DIR: resolve(env.AGENTS_DIR, "..", env.NORTH_CASSETTE_DIR ?? "cassettes"),
    AGENT_CONFIG_ROOT: resolve(env.AGENT_CONFIG_ROOT ?? ".agent-config"),
    NORTH_WORKER_PUBLIC_URL: env.NORTH_WORKER_PUBLIC_URL ?? (env.INTEGRATIONS_MODE === "sandbox" ? selfBaseUrl(env) : undefined),
  }));
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

/** The secret the sandbox signs unsubscribe tokens with when no real one is configured (sandbox on a loopback host only). */
export const SANDBOX_UNSUBSCRIBE_SECRET = "sandbox-unsubscribe-secret";

export type UnsubscribeEnv = Pick<WorkerEnv, "UNSUBSCRIBE_SECRET" | "INTEGRATIONS_MODE" | "WORKER_HOST">;

/**
 * The secret unsubscribe tokens are signed and verified with (CMP-1), or null
 * when the `/u/{token}` route must stay off: live mode without
 * `UNSUBSCRIBE_SECRET`, or sandbox mode off loopback, where the public sandbox
 * secret would let anyone forge an opt-out (the `sentrySecretFor` rule).
 */
export function unsubscribeSecretFor(env: UnsubscribeEnv): string | null {
  if (env.UNSUBSCRIBE_SECRET) return env.UNSUBSCRIBE_SECRET;
  return env.INTEGRATIONS_MODE === "sandbox" && isLoopbackHost(env.WORKER_HOST) ? SANDBOX_UNSUBSCRIBE_SECRET : null;
}

export type FenceEnv = Pick<WorkerEnv, "NORTH_TEST_FENCE" | "NORTH_FENCE_META_AD_ACCOUNTS" | "NORTH_FENCE_GITHUB_OWNERS" | "NORTH_FENCE_RECIPIENT_DOMAINS" | "NORTH_FENCE_VERCEL_PREFIX">;

/**
 * TST-5: the fence policy of the parsed env, through `fencePolicyFromEnv` (on
 * only with NORTH_TEST_FENCE=1). Meta ad account ids are normalised to
 * `act_<digits>` (`metaAdAccountId`), the form the gate builds from the
 * connection's `act:` scope, so `123` and `act_123` are the same account.
 */
export function fencePolicyFor(env: FenceEnv): FencePolicy {
  const policy = fencePolicyFromEnv({
    NORTH_TEST_FENCE: env.NORTH_TEST_FENCE,
    NORTH_FENCE_META_AD_ACCOUNTS: env.NORTH_FENCE_META_AD_ACCOUNTS,
    NORTH_FENCE_GITHUB_OWNERS: env.NORTH_FENCE_GITHUB_OWNERS,
    NORTH_FENCE_RECIPIENT_DOMAINS: env.NORTH_FENCE_RECIPIENT_DOMAINS,
    NORTH_FENCE_VERCEL_PREFIX: env.NORTH_FENCE_VERCEL_PREFIX,
  });
  return Object.freeze({ ...policy, metaAdAccounts: policy.metaAdAccounts.map(metaAdAccountId) });
}

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
