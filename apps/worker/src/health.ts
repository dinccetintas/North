import type { FencePolicy } from "@north/core";
import { sentrySecretFor, stripeSecretFor, unsubscribeSecretFor, type WorkerEnv } from "./env";
import type { GatewayStats } from "./gateway/server";
import type { SimClock } from "./services/clock";
import type { WorkerGateway } from "./services/runtime-deps";

export { selfBaseUrl } from "./host";

/** Within this many milliseconds of the wall clock the worker's clock counts as the wall clock. */
const WALL_TOLERANCE_MS = 1000;

/** The day's model budget as the gateway reports it. `exhausted` is its own field: a day closed by a reply that could not be priced. */
export interface HealthBudget {
  readonly capUsd: number;
  readonly spentUsd: number;
  readonly unpriced: number;
  readonly exhausted: boolean;
}

export interface WorkerHealth {
  readonly ok: true;
  readonly app: "north-worker";
  readonly time: string;
  readonly clock: string;
  readonly mode: WorkerEnv["INTEGRATIONS_MODE"];
  readonly runtime: WorkerEnv["AGENT_RUNTIME"];
  /** Which webhook routes are mounted (a secret resolved); never the secrets. */
  readonly webhooks: { readonly sentry: boolean; readonly stripe: boolean };
  /** CMP-1: whether `/u/{token}` can verify unsubscribe tokens (a secret resolves); never the secret or its source. A live worker must read true. */
  readonly unsubscribe: boolean;
  /** False while a sandbox harness has moved the clock (`POST /sandbox/clock`); production must read true. */
  readonly clockIsWall: boolean;
  readonly tracing: boolean;
  /** TST-1: the model profile aliases resolve on. */
  readonly profile: WorkerEnv["NORTH_MODEL_PROFILE"];
  /** TST-5: whether the test-account fence is on. */
  readonly fence: boolean;
  /** SEC-1 / TST-2: the gateway's mode; `off` when no gateway runs (the mock runtime). */
  readonly gateway: "off" | WorkerGateway["mode"];
  /** STG-1: `NORTH_ENV`. */
  readonly env: WorkerEnv["NORTH_ENV"];
  /** TST-1: the gateway's budget for today; null without a gateway. */
  readonly budget: HealthBudget | null;
}

/** The parts of the worker's gateway the health line reads. */
export type HealthGateway = Pick<WorkerGateway, "mode"> & { stats(): Pick<GatewayStats, "capUsd" | "spentUsd" | "unpriced" | "exhausted"> };

/** What `workerHealth` reads besides the env: the clock, tracing, the fence and the gateway. */
export interface HealthSources {
  readonly clock: () => Date;
  readonly simClock: SimClock | null;
  readonly tracing: boolean;
  readonly fence: Pick<FencePolicy, "enabled">;
  readonly gateway: HealthGateway | null;
}

export type HealthEnv = Pick<WorkerEnv, "INTEGRATIONS_MODE" | "AGENT_RUNTIME" | "WORKER_HOST" | "SENTRY_CLIENT_SECRET" | "STRIPE_WEBHOOK_SECRET" | "UNSUBSCRIBE_SECRET" | "NORTH_MODEL_PROFILE" | "NORTH_ENV">;

/** The four budget numbers, copied field by field so nothing else of the gateway's stats can reach the health line. */
function budgetOf(gateway: HealthGateway | null): HealthBudget | null {
  if (gateway === null) return null;
  const { capUsd, spentUsd, unpriced, exhausted } = gateway.stats();
  return Object.freeze({ capUsd, spentUsd, unpriced, exhausted });
}

/**
 * `GET /health` (OPS-1, STG-1): what `scripts/production-check.ts` reads:
 * mode, runtime, mounted webhooks, whether unsubscribe links can be verified,
 * whether the clock is the wall clock, the model profile, the fence, the
 * gateway mode, the deployment env and the day's model budget. Nothing secret (no key, no path, no URL), nothing about users.
 */
export function workerHealth(env: HealthEnv, sources: HealthSources): WorkerHealth {
  const { simClock } = sources;
  return Object.freeze({
    ok: true,
    app: "north-worker",
    time: new Date().toISOString(),
    clock: sources.clock().toISOString(),
    mode: env.INTEGRATIONS_MODE,
    runtime: env.AGENT_RUNTIME,
    webhooks: Object.freeze({ sentry: sentrySecretFor(env) !== null, stripe: stripeSecretFor(env) !== null }),
    unsubscribe: unsubscribeSecretFor(env) !== null,
    clockIsWall: simClock === null || Math.abs(simClock.offsetMs) < WALL_TOLERANCE_MS,
    tracing: sources.tracing,
    profile: env.NORTH_MODEL_PROFILE,
    fence: sources.fence.enabled,
    gateway: sources.gateway?.mode ?? "off",
    env: env.NORTH_ENV,
    budget: budgetOf(sources.gateway),
  });
}
