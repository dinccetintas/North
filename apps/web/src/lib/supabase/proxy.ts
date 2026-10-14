import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

const PUBLIC_PREFIXES = ["/login", "/auth", "/api/", "/p/", "/_next", "/favicon"];

function isPublicPath(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Refreshes the Supabase session cookie on every matched request and redirects
 * anonymous visitors away from app routes. Returns the response that carries
 * the refreshed cookies (returning any other response signs the user out).
 */
export async function updateSession(request: NextRequest) {
  const env = publicEnv();
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/companies";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
