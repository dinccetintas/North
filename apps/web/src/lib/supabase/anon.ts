import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database, DbClient } from "@north/db";
import { publicEnv } from "@/lib/env";

/**
 * PUB-1: the anonymous client for the public company page. No cookies and no
 * session, so the page can be cached; it can read nothing but what
 * `public_page_view(slug)` (security definer, granted to `anon`) returns.
 */
export function createAnonClient(): DbClient {
  const env = publicEnv();
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
