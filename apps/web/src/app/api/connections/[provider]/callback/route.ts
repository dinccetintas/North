import { NextResponse, type NextRequest } from "next/server";
import { EVENT } from "@north/core/events";
import { inngest } from "@/inngest/client";
import { publicEnv } from "@/lib/env";
import { OauthProviderSchema, parseStateCookie, STATE_COOKIE, stateMatches } from "@/lib/oauth";
import { currentUser } from "@/lib/supabase/server";

const CODE_MAX_LENGTH = 2048;

/**
 * ONB-3: the provider sends the user back here with a one-time code. The
 * state must match the cookie set by `start` (same provider, same browser,
 * same signed-in user, so a login-CSRF cannot bind the victim's GitHub to an
 * attacker's North account). The code goes to the worker as a
 * `connection/oauth_code` event; the token never touches the web app.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  const origin = publicEnv().NEXT_PUBLIC_APP_URL;
  const back = (query: string) => {
    const response = NextResponse.redirect(`${origin}/settings/connections?${query}`);
    response.cookies.set(STATE_COOKIE, "", { path: "/api/connections", maxAge: 0 });
    return response;
  };
  const provider = OauthProviderSchema.safeParse(raw);
  if (!provider.success) return back("error=unknown-provider");
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/settings/connections")}`);

  const cookie = parseStateCookie(request.cookies.get(STATE_COOKIE)?.value);
  const returnedState = request.nextUrl.searchParams.get("state");
  if (!cookie || cookie.provider !== provider.data || cookie.userId !== user.id || !stateMatches(cookie.state, returnedState)) return back(`error=${provider.data}-state`);

  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > CODE_MAX_LENGTH) return back(`error=${provider.data}-denied`);

  try {
    await inngest.send({ name: EVENT.connectionOauthCode, data: { userId: user.id, provider: provider.data, code, redirectUri: `${origin}/api/connections/${provider.data}/callback` } });
  } catch (error) {
    console.error("[connections] could not send connection/oauth_code", provider.data, error);
    return back(`error=${provider.data}-worker`);
  }
  return back(`pending=${provider.data}`);
}
