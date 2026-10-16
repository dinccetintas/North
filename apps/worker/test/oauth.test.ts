import { describe, expect, it } from "vitest";
import { exchangeGithubCode, exchangeGoogleCode, exchangeMetaCode, exchangeStripeCode, exchangeVercelCode, oauthClients, parseProviderToken, refreshGoogleToken, revokeProviderToken, serializeProviderToken, type FetchLike } from "../src/services/oauth";

const client = { clientId: "id", clientSecret: "s3cret" };
const now = () => new Date("2026-10-15T10:00:00.000Z");

/** A fetch that answers each URL (query string stripped) from a table and records the requests. */
function fakeFetch(answers: Record<string, { status?: number; body: unknown }>): { fetchImpl: FetchLike; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const answer = answers[url] ?? answers[url.split("?")[0] ?? url];
    if (!answer) return new Response("not found", { status: 404 });
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

describe("ONB-3 OAuth code exchange (worker side: client secrets never leave here)", () => {
  it("oauthClients reads id and secret pairs from the env; a missing half means not configured", () => {
    expect(oauthClients({})).toEqual({ github: null, vercel: null, meta_ads: null, gmail: null, stripe: null });
    expect(oauthClients({ GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b", VERCEL_CLIENT_ID: "c", META_APP_ID: "m", META_APP_SECRET: "ms", GOOGLE_CLIENT_ID: "g", STRIPE_CONNECT_CLIENT_ID: "ca_1" })).toEqual({
      github: { clientId: "a", clientSecret: "b" },
      vercel: null,
      meta_ads: { clientId: "m", clientSecret: "ms" },
      gmail: null,
      stripe: null,
    });
    expect(oauthClients({ STRIPE_CONNECT_CLIENT_ID: "ca_1", STRIPE_CONNECT_CLIENT_SECRET: "fake-secret" }).stripe).toEqual({ clientId: "ca_1", clientSecret: "fake-secret" });
  });

  it("OUT-2 Stripe Connect: form-encoded code exchange with the secret, the connected account's read-only token, the account id as the label; nothing secret in an error", async () => {
    const { fetchImpl, calls } = fakeFetch({ "https://connect.stripe.com/oauth/token": { body: { access_token: "fake-access", refresh_token: "fake-refresh", scope: "read_only", stripe_user_id: "acct_123", livemode: false } } });
    expect(await exchangeStripeCode(client, "ac_c0de", "http://localhost:3100/api/connections/stripe/callback", fetchImpl)).toEqual({ token: { accessToken: "fake-access", refreshToken: "fake-refresh" }, scopes: ["read_only"], accountLabel: "acct_123" });
    expect(calls[0]?.init?.method).toBe("POST");
    expect(String(calls[0]?.init?.body)).toBe("grant_type=authorization_code&code=ac_c0de&client_secret=s3cret");
    const refused = fakeFetch({ "https://connect.stripe.com/oauth/token": { status: 400, body: { error: "invalid_grant", error_description: "code already used" } } });
    const error = await exchangeStripeCode(client, "ac_c0de", "http://x/cb", refused.fetchImpl).catch((e: Error) => e);
    expect(String(error)).toContain("invalid_grant");
    expect(String(error)).not.toContain("s3cret");
    expect(await revokeProviderToken("stripe", client, JSON.stringify({ accessToken: "fake-access" }), fetchImpl)).toBe(false);
  });

  it("GitHub: posts the code with the secret, then reads the login for the account label", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://github.com/login/oauth/access_token": { body: { access_token: "gho_x", scope: "repo,read:user" } },
      "https://api.github.com/user": { body: { login: "octocat" } },
    });
    const token = await exchangeGithubCode(client, "c0de", "http://localhost:3100/api/connections/github/callback", fetchImpl);
    expect(token).toEqual({ token: "gho_x", scopes: ["repo", "read:user"], accountLabel: "octocat" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ client_id: "id", client_secret: "s3cret", code: "c0de", redirect_uri: "http://localhost:3100/api/connections/github/callback" });
    expect(calls[1]?.init?.headers).toMatchObject({ authorization: "Bearer gho_x" });
  });

  it("GitHub: a bad code fails with the provider's error and without the secret in the message", async () => {
    const { fetchImpl } = fakeFetch({ "https://github.com/login/oauth/access_token": { body: { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } } });
    await expect(exchangeGithubCode(client, "nope", "http://x/cb", fetchImpl)).rejects.toThrow(/bad_verification_code/);
    await expect(exchangeGithubCode(client, "nope", "http://x/cb", fetchImpl)).rejects.not.toThrow(/s3cret/);
  });

  it("Vercel: form-encoded exchange, team id kept as the scope, username as the label", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://api.vercel.com/v2/oauth/access_token": { body: { access_token: "vc_x", team_id: "team_1" } },
      "https://api.vercel.com/v2/user": { body: { user: { username: "dinc" } } },
    });
    const token = await exchangeVercelCode(client, "c0de", "http://x/cb", fetchImpl);
    expect(token).toEqual({ token: "vc_x", scopes: ["deployments"], accountLabel: "dinc", scope: "team_1" });
    expect(String(calls[0]?.init?.body)).toBe("client_id=id&client_secret=s3cret&code=c0de&redirect_uri=http%3A%2F%2Fx%2Fcb");
    const personal = fakeFetch({ "https://api.vercel.com/v2/oauth/access_token": { body: { access_token: "vc_y", team_id: null } }, "https://api.vercel.com/v2/user": { body: {} } });
    expect(await exchangeVercelCode(client, "c", "http://x/cb", personal.fetchImpl)).toEqual({ token: "vc_y", scopes: ["deployments"], accountLabel: "" });
    await expect(exchangeVercelCode(client, "c", "http://x/cb", fakeFetch({}).fetchImpl)).rejects.toThrow(/Vercel token exchange failed/);
  });

  it("Meta (BUD-2, ADR 0010): code → short-lived → long-lived token, first ad account as act:<id>, first page as page:<id>, account name as the label", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://graph.facebook.com/v21.0/oauth/access_token": { body: { access_token: "EAAB-short-or-long", expires_in: 5_184_000 } },
      "https://graph.facebook.com/v21.0/me/adaccounts": { body: { data: [{ id: "act_123", account_id: "123", name: "Acme ads" }] } },
      "https://graph.facebook.com/v21.0/me/accounts": { body: { data: [{ id: "456", name: "Acme page" }] } },
    });
    const token = await exchangeMetaCode(client, "c0de", "http://x/cb", fetchImpl, now);
    expect(token).toEqual({ token: { accessToken: "EAAB-short-or-long", expiresAt: "2026-12-14T10:00:00.000Z" }, scopes: ["act:123", "page:456"], accountLabel: "Acme ads" });
    const first = new URL(calls[0]?.url ?? "");
    expect(Object.fromEntries(first.searchParams)).toEqual({ client_id: "id", client_secret: "s3cret", redirect_uri: "http://x/cb", code: "c0de" });
    const second = new URL(calls[1]?.url ?? "");
    expect(Object.fromEntries(second.searchParams)).toEqual({ grant_type: "fb_exchange_token", client_id: "id", client_secret: "s3cret", fb_exchange_token: "EAAB-short-or-long" });
    expect(calls[2]?.url).toContain("/me/adaccounts");
    expect(calls[2]?.init?.headers).toMatchObject({ authorization: "Bearer EAAB-short-or-long" });
    expect(calls[3]?.url).toContain("/me/accounts");
    // No ad account → no connection: the adapter could never act.
    const none = fakeFetch({ "https://graph.facebook.com/v21.0/oauth/access_token": { body: { access_token: "t" } }, "https://graph.facebook.com/v21.0/me/adaccounts": { body: { data: [] } } });
    await expect(exchangeMetaCode(client, "c", "http://x/cb", none.fetchImpl, now)).rejects.toThrow(/no ad account/);
    await expect(exchangeMetaCode(client, "c", "http://x/cb", fakeFetch({}).fetchImpl, now)).rejects.not.toThrow(/s3cret/);
  });

  it("Google (SLS-K2): code → access + refresh token + expiry stored as the ProviderToken pair, mailbox as the label; refresh keeps the refresh token", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://oauth2.googleapis.com/token": { body: { access_token: "ya29.a", refresh_token: "1//r", expires_in: 3599, scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly" } },
      "https://www.googleapis.com/oauth2/v3/userinfo": { body: { email: "ceo@example.test" } },
    });
    const token = await exchangeGoogleCode(client, "c0de", "http://x/cb", fetchImpl, now);
    expect(token).toEqual({
      token: { accessToken: "ya29.a", refreshToken: "1//r", expiresAt: "2026-10-15T10:59:59.000Z" },
      scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"],
      accountLabel: "ceo@example.test",
    });
    expect(String(calls[0]?.init?.body)).toBe("client_id=id&client_secret=s3cret&code=c0de&redirect_uri=http%3A%2F%2Fx%2Fcb&grant_type=authorization_code");
    expect(JSON.parse(serializeProviderToken(token.token))).toEqual(token.token);
    expect(parseProviderToken(serializeProviderToken(token.token))).toEqual(token.token);
    expect(parseProviderToken("gho_plain")).toBe("gho_plain");
    expect(parseProviderToken("{broken")).toBeNull();
    // userinfo refused (no openid scope) → the Gmail profile gives the address.
    const viaProfile = fakeFetch({
      "https://oauth2.googleapis.com/token": { body: { access_token: "ya29.b", refresh_token: "1//s", expires_in: 100 } },
      "https://www.googleapis.com/oauth2/v3/userinfo": { status: 401, body: {} },
      "https://gmail.googleapis.com/gmail/v1/users/me/profile": { body: { emailAddress: "ceo@example.test" } },
    });
    expect((await exchangeGoogleCode(client, "c", "http://x/cb", viaProfile.fetchImpl, now)).accountLabel).toBe("ceo@example.test");
    const refreshed = fakeFetch({ "https://oauth2.googleapis.com/token": { body: { access_token: "ya29.c", expires_in: 3600 } } });
    expect(await refreshGoogleToken(client, "1//r", refreshed.fetchImpl, now)).toEqual({ accessToken: "ya29.c", refreshToken: "1//r", expiresAt: "2026-10-15T11:00:00.000Z" });
    expect(String(refreshed.calls[0]?.init?.body)).toBe("client_id=id&client_secret=s3cret&refresh_token=1%2F%2Fr&grant_type=refresh_token");
  });

  it("revokeProviderToken: GitHub with the app's basic auth (404 counts as gone); Google through oauth2 revoke with the refresh token; Vercel and Meta are left to their dashboards", async () => {
    const { fetchImpl, calls } = fakeFetch({ "https://api.github.com/applications/id/token": { status: 204, body: {} } });
    expect(await revokeProviderToken("github", client, "gho_x", fetchImpl)).toBe(true);
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: `Basic ${Buffer.from("id:s3cret").toString("base64")}` });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ access_token: "gho_x" });
    expect(await revokeProviderToken("github", client, "gho_x", fakeFetch({}).fetchImpl)).toBe(true);
    expect(await revokeProviderToken("github", client, "gho_x", fakeFetch({ "https://api.github.com/applications/id/token": { status: 500, body: {} } }).fetchImpl)).toBe(false);
    expect(await revokeProviderToken("github", null, "gho_x", fetchImpl)).toBe(false);
    expect(await revokeProviderToken("vercel", client, "vc_x", fetchImpl)).toBe(false);
    expect(await revokeProviderToken("meta_ads", client, JSON.stringify({ accessToken: "EAAB" }), fetchImpl)).toBe(false);
    const google = fakeFetch({ "https://oauth2.googleapis.com/revoke": { body: {} } });
    expect(await revokeProviderToken("gmail", client, JSON.stringify({ accessToken: "ya29.a", refreshToken: "1//r" }), google.fetchImpl)).toBe(true);
    expect(String(google.calls[0]?.init?.body)).toBe("token=1%2F%2Fr");
    expect(await revokeProviderToken("gmail", client, "", google.fetchImpl)).toBe(false);
  });
});
