import * as Sentry from "@sentry/node";
import type { WorkerEnv } from "./env";

/**
 * OBS-1: the worker reports its own errors to Sentry when `SENTRY_DSN` is
 * set; no custom instrumentation (Langfuse and the web's Sentry are M6 work,
 * docs/plans/M5.md "Scope decisions"). Without a DSN nothing is initialised,
 * so a sandbox worker never phones out.
 */
export function initObservability(env: Pick<WorkerEnv, "SENTRY_DSN" | "NODE_ENV" | "INTEGRATIONS_MODE">): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({ dsn: env.SENTRY_DSN, environment: `${env.NODE_ENV}-${env.INTEGRATIONS_MODE}`, sendDefaultPii: false, tracesSampleRate: 0 });
  return true;
}
