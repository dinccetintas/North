import { sentrySecretFor, stripeSecretFor, type WorkerEnv } from "./env";
import type { SimClock } from "./services/clock";

/** Within this many milliseconds of the wall clock the worker's clock counts as the wall clock. */
const WALL_TOLERANCE_MS = 1000;

export interface WorkerHealth {
  readonly ok: true;
  readonly app: "north-worker";
  readonly time: string;
  readonly clock: string;
  readonly mode: WorkerEnv["INTEGRATIONS_MODE"];
  readonly runtime: WorkerEnv["AGENT_RUNTIME"];
  /** Which webhook routes are mounted (a secret resolved); never the secrets. */
  readonly webhooks: { readonly sentry: boolean; readonly stripe: boolean };
  /** False while a sandbox harness has moved the clock (`POST /sandbox/clock`); production must read true. */
  readonly clockIsWall: boolean;
  readonly tracing: boolean;
}

/**
 * `GET /health` (OPS-1): what `scripts/production-check.ts` reads: mode,
 * runtime, mounted webhooks and whether the clock is the wall clock. Nothing
 * secret, nothing about users.
 */
export function workerHealth(env: Pick<WorkerEnv, "INTEGRATIONS_MODE" | "AGENT_RUNTIME" | "WORKER_HOST" | "SENTRY_CLIENT_SECRET" | "STRIPE_WEBHOOK_SECRET">, clock: () => Date, simClock: SimClock | null, tracing: boolean): WorkerHealth {
  return Object.freeze({
    ok: true,
    app: "north-worker",
    time: new Date().toISOString(),
    clock: clock().toISOString(),
    mode: env.INTEGRATIONS_MODE,
    runtime: env.AGENT_RUNTIME,
    webhooks: Object.freeze({ sentry: sentrySecretFor(env) !== null, stripe: stripeSecretFor(env) !== null }),
    clockIsWall: simClock === null || Math.abs(simClock.offsetMs) < WALL_TOLERANCE_MS,
    tracing,
  });
}

/** The worker's own base URL on its loopback bind (the sandbox billing pages post to its webhook). */
export function selfBaseUrl(env: Pick<WorkerEnv, "WORKER_HOST" | "WORKER_PORT">): string {
  const host = env.WORKER_HOST.includes(":") && !env.WORKER_HOST.startsWith("[") ? `[${env.WORKER_HOST}]` : env.WORKER_HOST;
  return `http://${host}:${env.WORKER_PORT}`;
}
