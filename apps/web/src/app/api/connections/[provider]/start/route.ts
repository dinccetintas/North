import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { newState, oauthConfig, OauthProviderSchema, STATE_COOKIE, STATE_TTL_SECONDS, stateCookieValue } from "@/lib/oauth";
import { currentUser } from "@/lib/supabase/server";

const settings = (origin: string, query: string) => NextResponse.redirect(`${origin}/settings/connections?${query}`);

/**
 * ONB-3: starts the provider's OAuth flow for the signed-in user. Sets the
 * random state in an httpOnly cookie and redirects to the provider. Without a
 * client id the settings page offers a sandbox connection instead, so this
 * route answers with an error rather than a half-configured redirect.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  const origin = publicEnv().NEXT_PUBLIC_APP_URL;
  const provider = OauthProviderSchema.safeParse(raw);
  if (!provider.success) return settings(origin, "error=unknown-provider");
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/settings/connections")}`);
  const config = oauthConfig(provider.data);
  if (!config) return settings(origin, `error=${provider.data}-not-configured`);

  const state = newState();
  const redirectUri = `${origin}/api/connections/${provider.data}/callback`;
  const response = NextResponse.redirect(config.authorizeUrl(state, redirectUri));
  response.cookies.set(STATE_COOKIE, stateCookieValue(provider.data, state), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/connections",
    maxAge: STATE_TTL_SECONDS,
  });
  return response;
}
