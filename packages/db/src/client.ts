import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type DbClient = SupabaseClient<Database>;

export interface ServiceClientConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
}

/**
 * Service-role client for the worker. Bypasses RLS, so every query made with it
 * must be scoped to the company being processed (see `scopedTo`).
 */
export function createServiceClient(config: ServiceClientConfig): DbClient {
  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Reads config from the environment; throws a clear error when missing. */
export function serviceClientFromEnv(env: NodeJS.ProcessEnv = process.env): DbClient {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the service client");
  }
  return createServiceClient({ url, serviceRoleKey });
}
