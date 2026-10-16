import { z } from "zod";
import type { BillingRedirectPolicy } from "./billing-view";

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});
export type PublicEnv = z.infer<typeof PublicEnvSchema>;

const IntegrationsModeSchema = z.enum(["sandbox", "live"]).default("sandbox");

/** The web app's view of the integrations mode: it only decides whether "Connect (sandbox)" is offered; the worker enforces it. */
export function integrationsMode(env: Readonly<Record<string, string | undefined>> = process.env): "sandbox" | "live" {
  const parsed = IntegrationsModeSchema.safeParse(env.INTEGRATIONS_MODE || undefined);
  if (!parsed.success) throw new Error("INTEGRATIONS_MODE must be sandbox or live");
  return parsed.data;
}

const originOf = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/**
 * M6 review L6: what the billing go page may follow. The sandbox origin is
 * the one the worker's sandbox billing adapter builds its page URLs with
 * (`SANDBOX_SITE_BASE_URL`, else `http://127.0.0.1:<WORKER_PORT>`), read by
 * the same names so one value configures both processes and the defaults
 * agree with none. Server only (the go page and the poll action), so no
 * `NEXT_PUBLIC_` value is inlined into the bundle.
 */
export function billingRedirectPolicy(env: Readonly<Record<string, string | undefined>> = process.env): BillingRedirectPolicy {
  return { mode: integrationsMode(env), sandboxOrigin: originOf(env.SANDBOX_SITE_BASE_URL || `http://127.0.0.1:${env.WORKER_PORT || "3101"}`) };
}

const SentryDsnSchema = z.string().url().refine((value) => value.startsWith("https://"), { message: "https DSN" });

/**
 * OBS-1: the web's Sentry DSN (`NEXT_PUBLIC_SENTRY_DSN`, a public value by
 * design; the worker's own DSN never reaches the web). Null turns Sentry off.
 */
export function sentryDsn(value: string | undefined = process.env.NEXT_PUBLIC_SENTRY_DSN): string | null {
  const parsed = SentryDsnSchema.safeParse(value || undefined);
  return parsed.success ? parsed.data : null;
}

/**
 * Validated public environment. Values are read explicitly so Next.js can
 * inline them for the browser bundle.
 */
export function publicEnv(): PublicEnv {
  const parsed = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    throw new Error(`Missing or invalid public env: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}
