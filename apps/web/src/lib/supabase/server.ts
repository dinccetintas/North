import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@north/db";
import { publicEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Server Components cannot write cookies; the proxy refreshes sessions instead.
 */
export async function createClient() {
  const env = publicEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy handles refresh there.
        }
      },
    },
  });
}

/** Verified claims for the signed-in user, or null. Never trust getSession() on the server. */
export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const claims = data.claims as { sub?: string; email?: string };
  if (!claims.sub) return null;
  return { id: claims.sub, email: claims.email ?? "" };
}
