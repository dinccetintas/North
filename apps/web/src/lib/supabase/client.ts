import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@north/db";
import { publicEnv } from "@/lib/env";

/** Supabase client for Client Components (browser). */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
