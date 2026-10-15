import type { ConnectionOauthCodeEvent } from "@north/core";
import { dropConnectionSecret, getConnection, readConnectionSecret, setConnectionStatus, storeConnectionSecret, upsertConnection } from "@north/db";
import type { WorkerDeps } from "../deps";
import { TEAM_SCOPE_PREFIX } from "./provider-auth";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OauthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

const PROVIDER_TIMEOUT_MS = 10_000;

/** Every call to a provider carries a timeout so a hung endpoint never holds an Inngest step open. */
export const timedFetch: FetchLike = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });

/** Client credentials per provider, from the worker env only (the web app has the ids, never the secrets). */
export function oauthClients(env: NodeJS.ProcessEnv): Readonly<Record<"github" | "vercel", OauthClient | null>> {
  const pick = (id: string | undefined, secret: string | undefined): OauthClient | null => (id && secret ? { clientId: id, clientSecret: secret } : null);
  return Object.freeze({ github: pick(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET), vercel: pick(env.VERCEL_CLIENT_ID, env.VERCEL_CLIENT_SECRET) });
}

export interface ExchangedToken {
  readonly token: string;
  readonly scopes: readonly string[];
  readonly accountLabel: string;
  /** Vercel team id when the integration was installed on a team. */
  readonly scope?: string;
}

/** GitHub OAuth app: code → token, then the login for the label. Errors never include the client secret. */
export async function exchangeGithubCode(client: OauthClient, code: string, redirectUri: string, fetchImpl: FetchLike): Promise<ExchangedToken> {
  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri }),
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; scope?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(`GitHub token exchange failed: ${data.error ?? response.status} ${data.error_description ?? ""}`.trim());
  const user = await fetchImpl("https://api.github.com/user", { headers: { authorization: `Bearer ${data.access_token}`, accept: "application/vnd.github+json" } });
  const profile = (await user.json().catch(() => ({}))) as { login?: string };
  return Object.freeze({ token: data.access_token, scopes: (data.scope ?? "").split(",").filter(Boolean), accountLabel: profile.login ?? "" });
}

/** Vercel integration: code → token (+ team id), then the user for the label. */
export async function exchangeVercelCode(client: OauthClient, code: string, redirectUri: string, fetchImpl: FetchLike): Promise<ExchangedToken> {
  const body = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: redirectUri });
  const response = await fetchImpl("https://api.vercel.com/v2/oauth/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; team_id?: string | null; error?: string };
  if (!response.ok || !data.access_token) throw new Error(`Vercel token exchange failed: ${data.error ?? response.status}`);
  const user = await fetchImpl("https://api.vercel.com/v2/user", { headers: { authorization: `Bearer ${data.access_token}` } });
  const profile = (await user.json().catch(() => ({}))) as { user?: { username?: string } };
  return Object.freeze({ token: data.access_token, scopes: ["deployments"], accountLabel: profile.user?.username ?? "", ...(data.team_id ? { scope: data.team_id } : {}) });
}

/**
 * Tells the provider the token is no longer wanted (best effort, before the
 * ciphertext is dropped). GitHub has an endpoint for OAuth-app tokens; Vercel
 * integration tokens are revoked by uninstalling the integration in the
 * dashboard, which is left to the user and documented on the settings page.
 */
export async function revokeProviderToken(provider: "github" | "vercel", client: OauthClient | null, token: string, fetchImpl: FetchLike): Promise<boolean> {
  if (provider !== "github" || !client) return false;
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
  const response = await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(client.clientId)}/token`, {
    method: "DELETE",
    headers: { authorization: `Basic ${basic}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  return response.status === 204 || response.status === 404;
}

/**
 * ONB-3: completes a connection from the one-time code the web callback
 * forwarded. The row is written as `error` first, the token is encrypted and
 * stored by the service role, then the row becomes `connected`: a row never
 * says "connected" without a secret behind it. The account label is for
 * display; a Vercel team id travels as a `team:<id>` scope.
 */
export async function completeConnection(deps: WorkerDeps, event: ConnectionOauthCodeEvent, fetchImpl: FetchLike = timedFetch): Promise<{ readonly connected: boolean; readonly accountLabel: string }> {
  const clients = oauthClients(process.env);
  const client = clients[event.provider];
  if (!client) throw new Error(`${event.provider} OAuth is not configured on the worker (client id and secret)`);
  let exchanged: ExchangedToken;
  try {
    exchanged = event.provider === "github" ? await exchangeGithubCode(client, event.code, event.redirectUri, fetchImpl) : await exchangeVercelCode(client, event.code, event.redirectUri, fetchImpl);
  } catch (cause) {
    await upsertConnection(deps.db, { userId: event.userId, provider: event.provider, scopes: [], accountLabel: "", status: "error" });
    throw cause;
  }
  const scopes = [...exchanged.scopes, ...(exchanged.scope ? [`${TEAM_SCOPE_PREFIX}${exchanged.scope}`] : [])];
  const connection = await upsertConnection(deps.db, { userId: event.userId, provider: event.provider, scopes, accountLabel: exchanged.accountLabel, status: "error" });
  await storeConnectionSecret(deps.db, connection.id, exchanged.token);
  await setConnectionStatus(deps.db, connection.id, "connected");
  return { connected: true, accountLabel: connection.accountLabel };
}

/** The owner revoked from the settings page; the worker revokes at the provider when it can and drops the token it alone can reach. */
export async function dropRevokedSecret(deps: WorkerDeps, userId: string, provider: "github" | "vercel" | "gmail" | "stripe" | "meta_ads", fetchImpl: FetchLike = timedFetch): Promise<{ readonly dropped: boolean; readonly revokedAtProvider: boolean }> {
  const connection = await getConnection(deps.db, userId, provider);
  if (!connection || connection.status === "connected") return { dropped: false, revokedAtProvider: false };
  let revokedAtProvider = false;
  if (provider === "github" || provider === "vercel") {
    try {
      const token = await readConnectionSecret(deps.db, connection.id);
      revokedAtProvider = await revokeProviderToken(provider, oauthClients(process.env)[provider], token, fetchImpl);
    } catch (cause) {
      // No secret (sandbox row, already dropped) or the provider refused: the ciphertext still goes.
      console.error(`[connections] ${provider} revoke at provider skipped: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  await dropConnectionSecret(deps.db, connection.id);
  return { dropped: true, revokedAtProvider };
}
