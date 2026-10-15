import { z } from "zod";

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
