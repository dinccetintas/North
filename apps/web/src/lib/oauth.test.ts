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

  it("the cookie binds the state to a provider", () => {
    const value = stateCookieValue("github", "abc.def");
    expect(parseStateCookie(value)).toEqual({ provider: "github", state: "abc.def" });
    expect(parseStateCookie("vercel.")).toBeNull();
    expect(parseStateCookie("stripe.x")).toBeNull();
    expect(parseStateCookie(undefined)).toBeNull();
    expect(parseStateCookie("nodot")).toBeNull();
  });
});
