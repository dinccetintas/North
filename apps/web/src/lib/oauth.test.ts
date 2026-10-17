import { describe, expect, it } from "vitest";
import { newState, oauthConfig, parseStateCookie, stateCookieValue, stateMatches } from "./oauth";

describe("ONB-3 OAuth helpers (web side: public ids and CSRF state only)", () => {
  it("builds the GitHub authorize URL with the client id, redirect, scope and state; null without a client id", () => {
    expect(oauthConfig("github", {})).toBeNull();
    const config = oauthConfig("github", { GITHUB_CLIENT_ID: "iv1.abc" });
    const url = new URL(config!.authorizeUrl("st4te", "http://localhost:3100/api/connections/github/callback"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "iv1.abc", redirect_uri: "http://localhost:3100/api/connections/github/callback", scope: "repo", state: "st4te" });
  });

  it("builds the Vercel integration install URL from the slug and carries the state", () => {
    expect(oauthConfig("vercel", {})).toBeNull();
    const url = new URL(oauthConfig("vercel", { VERCEL_INTEGRATION_SLUG: "north dev" })!.authorizeUrl("s", "ignored"));
    expect(url.pathname).toBe("/integrations/north%20dev/new");
    expect(url.searchParams.get("state")).toBe("s");
  });

  it("state is random, URL-safe, and only matches itself", () => {
    const a = newState();
    const b = newState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(stateMatches(a, a)).toBe(true);
    expect(stateMatches(a, b)).toBe(false);
    expect(stateMatches(a, `${a}x`)).toBe(false);
    expect(stateMatches(undefined, a)).toBe(false);
    expect(stateMatches(a, null)).toBe(false);
  });

  it("the cookie binds the state to a provider and to the signed-in user", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const value = stateCookieValue("github", userId, "abc.def");
    expect(parseStateCookie(value)).toEqual({ provider: "github", userId, state: "abc.def" });
    expect(parseStateCookie(`vercel.${userId}.`)).toBeNull();
    expect(parseStateCookie(`stripe.${userId}.x`)).toBeNull();
    expect(parseStateCookie("github.not-a-uuid.x")).toBeNull();
    expect(parseStateCookie("github.x")).toBeNull();
    expect(parseStateCookie(undefined)).toBeNull();
    expect(parseStateCookie("nodot")).toBeNull();
  });

  it("GITHUB_OAUTH_SCOPE narrows the default repo scope", () => {
    const url = new URL(oauthConfig("github", { GITHUB_CLIENT_ID: "x", GITHUB_OAUTH_SCOPE: "public_repo" })!.authorizeUrl("s", "http://x/cb"));
    expect(url.searchParams.get("scope")).toBe("public_repo");
  });

  it("M4: builds the Meta Ads dialog URL from META_APP_ID with the ads scopes; null without it", () => {
    expect(oauthConfig("meta_ads", {})).toBeNull();
    const config = oauthConfig("meta_ads", { META_APP_ID: "123456" });
    expect(config!.publicId).toBe("123456");
    const url = new URL(config!.authorizeUrl("st4te", "http://localhost:3100/api/connections/meta_ads/callback"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123456",
      redirect_uri: "http://localhost:3100/api/connections/meta_ads/callback",
      scope: "ads_management,ads_read,pages_show_list",
      response_type: "code",
      state: "st4te",
    });
  });

  it("M4: builds the Google consent URL for Gmail with offline access and a forced consent (refresh token); null without a client id", () => {
    expect(oauthConfig("gmail", {})).toBeNull();
    const url = new URL(oauthConfig("gmail", { GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com" })!.authorizeUrl("st4te", "http://localhost:3100/api/connections/gmail/callback"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "abc.apps.googleusercontent.com",
      redirect_uri: "http://localhost:3100/api/connections/gmail/callback",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent",
      state: "st4te",
    });
  });

  it("M4: the state cookie binds Meta and Gmail states to their provider too", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    expect(parseStateCookie(stateCookieValue("meta_ads", userId, "abc"))).toEqual({ provider: "meta_ads", userId, state: "abc" });
    expect(parseStateCookie(stateCookieValue("gmail", userId, "abc"))).toEqual({ provider: "gmail", userId, state: "abc" });
    expect(parseStateCookie(`meta.${userId}.abc`)).toBeNull();
  });
});
