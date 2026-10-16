import { ProviderTokenSchema, type ProviderToken } from "@north/core";

/**
 * The provider side of ONB-3 (ADR 0008, ADR 0010): one-time code → token per
 * provider, the Google refresh, and the revoke calls. Every request carries a
 * timeout; no error message ever contains a client secret or a token.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OauthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

export const OAUTH_CLIENT_PROVIDERS = ["github", "vercel", "meta_ads", "gmail", "stripe"] as const;
export type OauthClientProvider = (typeof OAUTH_CLIENT_PROVIDERS)[number];

const PROVIDER_TIMEOUT_MS = 10_000;
export const META_GRAPH = "https://graph.facebook.com/v21.0";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
export const STRIPE_CONNECT_TOKEN_URL = "https://connect.stripe.com/oauth/token";

/** Every call to a provider carries a timeout so a hung endpoint never holds an Inngest step open. */
export const timedFetch: FetchLike = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });

/** Client credentials per provider, from the worker env only (the web app has the ids, never the secrets). */
export function oauthClients(env: NodeJS.ProcessEnv): Readonly<Record<OauthClientProvider, OauthClient | null>> {
  const pick = (id: string | undefined, secret: string | undefined): OauthClient | null => (id && secret ? { clientId: id, clientSecret: secret } : null);
  return Object.freeze({
    github: pick(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    vercel: pick(env.VERCEL_CLIENT_ID, env.VERCEL_CLIENT_SECRET),
    meta_ads: pick(env.META_APP_ID, env.META_APP_SECRET),
    gmail: pick(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    // OUT-2 (M6): the user's own Stripe through Stripe Connect; optional, like every other provider.
    stripe: pick(env.STRIPE_CONNECT_CLIENT_ID, env.STRIPE_CONNECT_CLIENT_SECRET),
  });
}

export interface ExchangedToken {
  /** A plain token (GitHub, Vercel) or an access/refresh pair with its expiry (Google, Meta); stored as `ProviderTokenSchema`. */
  readonly token: ProviderToken;
  readonly scopes: readonly string[];
  readonly accountLabel: string;
  /** Vercel team id when the integration was installed on a team. */
  readonly scope?: string;
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}`, accept: "application/json" });
const json = async <T>(response: Response): Promise<T> => (await response.json().catch(() => ({}))) as T;
const expiresAtFrom = (expiresIn: number | undefined, now: () => Date): string | undefined => (typeof expiresIn === "number" && expiresIn > 0 ? new Date(now().getTime() + expiresIn * 1000).toISOString() : undefined);

/** GitHub OAuth app: code → token, then the login for the label. Errors never include the client secret. */
export async function exchangeGithubCode(client: OauthClient, code: string, redirectUri: string, fetchImpl: FetchLike): Promise<ExchangedToken> {
  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri }),
  });
  const data = await json<{ access_token?: string; scope?: string; error?: string; error_description?: string }>(response);
  if (!response.ok || !data.access_token) throw new Error(`GitHub token exchange failed: ${data.error ?? response.status} ${data.error_description ?? ""}`.trim());
  const user = await fetchImpl("https://api.github.com/user", { headers: { authorization: `Bearer ${data.access_token}`, accept: "application/vnd.github+json" } });
  const profile = await json<{ login?: string }>(user);
  return Object.freeze({ token: data.access_token, scopes: (data.scope ?? "").split(",").filter(Boolean), accountLabel: profile.login ?? "" });
}

/** Vercel integration: code → token (+ team id), then the user for the label. */
export async function exchangeVercelCode(client: OauthClient, code: string, redirectUri: string, fetchImpl: FetchLike): Promise<ExchangedToken> {
  const body = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri });
  const response = await fetchImpl("https://api.vercel.com/v2/oauth/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const data = await json<{ access_token?: string; team_id?: string | null; error?: string }>(response);
  if (!response.ok || !data.access_token) throw new Error(`Vercel token exchange failed: ${data.error ?? response.status}`);
  const user = await fetchImpl("https://api.vercel.com/v2/user", { headers: { authorization: `Bearer ${data.access_token}` } });
  const profile = await json<{ user?: { username?: string } }>(user);
  return Object.freeze({ token: data.access_token, scopes: ["deployments"], accountLabel: profile.user?.username ?? "", ...(data.team_id ? { scope: data.team_id } : {}) });
}

interface MetaTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly error?: { readonly message?: string; readonly type?: string };
}

async function metaToken(fetchImpl: FetchLike, params: Record<string, string>, what: string): Promise<MetaTokenResponse> {
  const response = await fetchImpl(`${META_GRAPH}/oauth/access_token?${new URLSearchParams(params).toString()}`, { headers: { accept: "application/json" } });
  const data = await json<MetaTokenResponse>(response);
  if (!response.ok || !data.access_token) throw new Error(`Meta ${what} failed: ${data.error?.type ?? response.status} ${data.error?.message ?? ""}`.trim());
  return data;
}

/**
 * Meta app (BUD-2, ADR 0010): code → short-lived token → long-lived token
 * (~60 days), then the first ad account the token can see becomes the
 * `act:<id>` scope and the first page the `page:<id>` scope; the ad account
 * name is the label. The secret travels in the query string Meta requires,
 * never in an error. Tokens are bearer headers from here on.
 */
export async function exchangeMetaCode(client: OauthClient, code: string, redirectUri: string, fetchImpl: FetchLike, now: () => Date = () => new Date()): Promise<ExchangedToken> {
  const shortLived = await metaToken(fetchImpl, { client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, code }, "code exchange");
  const longLived = await metaToken(fetchImpl, { grant_type: "fb_exchange_token", client_id: client.clientId, client_secret: client.clientSecret, fb_exchange_token: shortLived.access_token ?? "" }, "long-lived token exchange");
  const token = longLived.access_token ?? "";
  const accounts = await json<{ data?: readonly { id?: string; account_id?: string; name?: string }[] }>(await fetchImpl(`${META_GRAPH}/me/adaccounts?fields=id,account_id,name&limit=1`, { headers: bearer(token) }));
  const account = accounts.data?.[0];
  const accountId = account?.account_id ?? account?.id?.replace(/^act_/, "");
  if (!accountId) throw new Error("Meta Ads connection has no ad account: the user must have access to at least one ad account");
  const pages = await json<{ data?: readonly { id?: string }[] }>(await fetchImpl(`${META_GRAPH}/me/accounts?fields=id,name&limit=1`, { headers: bearer(token) }));
  const pageId = pages.data?.[0]?.id;
  const expiresAt = expiresAtFrom(longLived.expires_in, now);
  return Object.freeze({
    token: { accessToken: token, ...(expiresAt ? { expiresAt } : {}) },
    scopes: [`act:${accountId}`, ...(pageId ? [`page:${pageId}`] : [])],
    accountLabel: account?.name ?? accountId,
  });
}

interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

async function googleToken(client: OauthClient, params: Record<string, string>, fetchImpl: FetchLike, what: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...params });
  const response = await fetchImpl(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString() });
  const data = await json<GoogleTokenResponse>(response);
  if (!response.ok || !data.access_token) throw new Error(`Google ${what} failed: ${data.error ?? response.status} ${data.error_description ?? ""}`.trim());
  return data;
}

/** The connected mailbox address: `userinfo` when the token allows it, else the Gmail profile (always in scope for gmail.readonly). */
async function googleAccountLabel(token: string, fetchImpl: FetchLike): Promise<string> {
  const info = await json<{ email?: string }>(await fetchImpl(GOOGLE_USERINFO_URL, { headers: bearer(token) }));
  if (info.email) return info.email;
  const profile = await json<{ emailAddress?: string }>(await fetchImpl(GMAIL_PROFILE_URL, { headers: bearer(token) }));
  return profile.emailAddress ?? "";
}

/** Google OAuth client (SLS-K2, ADR 0010): code → access + refresh token + expiry; the mailbox address is the label. */
export async function exchangeGoogleCode(client: OauthClient, code: string, redirectUri: string, fetchImpl: FetchLike, now: () => Date = () => new Date()): Promise<ExchangedToken> {
  const data = await googleToken(client, { code, redirect_uri: redirectUri, grant_type: "authorization_code" }, fetchImpl, "code exchange");
  const expiresAt = expiresAtFrom(data.expires_in, now);
  return Object.freeze({
    token: { accessToken: data.access_token ?? "", ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}), ...(expiresAt ? { expiresAt } : {}) },
    scopes: (data.scope ?? "").split(" ").filter(Boolean),
    accountLabel: await googleAccountLabel(data.access_token ?? "", fetchImpl),
  });
}

/**
 * Stripe Connect (OUT-2, ADR 0010, `read_only` scope): the one-time code →
 * the connected account's read-only access token (and refresh token); the
 * account id (`acct_…`) is the label. The token is the account's own, so the
 * read sends no `Stripe-Account` header. The secret travels in the form body
 * Stripe requires, never in an error.
 */
export async function exchangeStripeCode(client: OauthClient, code: string, _redirectUri: string, fetchImpl: FetchLike): Promise<ExchangedToken> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, client_secret: client.clientSecret });
  const response = await fetchImpl(STRIPE_CONNECT_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString() });
  const data = await json<{ access_token?: string; refresh_token?: string; scope?: string; stripe_user_id?: string; error?: string }>(response);
  if (!response.ok || !data.access_token || !data.stripe_user_id) throw new Error(`Stripe Connect token exchange failed: ${data.error ?? response.status}`);
  return Object.freeze({
    token: { accessToken: data.access_token, ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}) },
    scopes: (data.scope ?? "read_only").split(/[\s,]+/).filter(Boolean),
    accountLabel: data.stripe_user_id,
  });
}

/** `grant_type=refresh_token`: a fresh access token with the same refresh token (Google does not rotate it) and a new expiry. */
export async function refreshGoogleToken(client: OauthClient, refreshToken: string, fetchImpl: FetchLike, now: () => Date = () => new Date()): Promise<ProviderToken> {
  const data = await googleToken(client, { refresh_token: refreshToken, grant_type: "refresh_token" }, fetchImpl, "token refresh");
  const expiresAt = expiresAtFrom(data.expires_in, now);
  return Object.freeze({ accessToken: data.access_token ?? "", refreshToken: data.refresh_token ?? refreshToken, ...(expiresAt ? { expiresAt } : {}) });
}

/** The stored secret as a `ProviderToken` (plain string or the JSON pair); null when it is neither. */
export function parseProviderToken(secret: string): ProviderToken | null {
  const trimmed = secret.trim();
  if (!trimmed.startsWith("{")) return trimmed.length > 0 ? trimmed : null;
  try {
    const parsed = ProviderTokenSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The string a secret is stored as: plain tokens as they are, pairs as JSON. */
export const serializeProviderToken = (token: ProviderToken): string => (typeof token === "string" ? token : JSON.stringify(token));

/**
 * Tells the provider the token is no longer wanted (best effort, before the
 * ciphertext is dropped). GitHub and Google have endpoints; Vercel tokens are
 * revoked by uninstalling the integration, Meta ones by removing the app in
 * the user's Facebook settings and Stripe Connect ones by disconnecting North
 * in the user's Stripe dashboard, all documented on the settings page.
 */
export async function revokeProviderToken(provider: OauthClientProvider, client: OauthClient | null, secret: string, fetchImpl: FetchLike): Promise<boolean> {
  if (provider === "github" && client) {
    const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
    const response = await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(client.clientId)}/token`, {
      method: "DELETE",
      headers: { authorization: `Basic ${basic}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ access_token: secret }),
    });
    return response.status === 204 || response.status === 404;
  }
  if (provider === "gmail") {
    const token = parseProviderToken(secret);
    const value = typeof token === "string" ? token : (token?.refreshToken ?? token?.accessToken);
    if (!value) return false;
    const response = await fetchImpl(GOOGLE_REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: value }).toString() });
    return response.ok;
  }
  return false;
}
