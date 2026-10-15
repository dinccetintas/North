import type { ConnectionOauthCodeEvent } from "@north/core";
import { dropConnectionSecret, getConnection, storeConnectionSecret, upsertConnection } from "@north/db";
import type { WorkerDeps } from "../deps";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OauthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

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
 * ONB-3: completes a connection from the one-time code the web callback
 * forwarded. The token is encrypted and stored by the service role; the
 * connection row shows the account label to the owner.
 */
export async function completeConnection(deps: WorkerDeps, event: ConnectionOauthCodeEvent, fetchImpl: FetchLike = (i, init) => fetch(i, init)): Promise<{ readonly connected: boolean; readonly accountLabel: string }> {
  const clients = oauthClients(process.env);
  const client = clients[event.provider];
  if (!client) throw new Error(`${event.provider} OAuth is not configured on the worker (client id and secret)`);
  const exchanged = event.provider === "github" ? await exchangeGithubCode(client, event.code, event.redirectUri, fetchImpl) : await exchangeVercelCode(client, event.code, event.redirectUri, fetchImpl);
  const connection = await upsertConnection(deps.db, { userId: event.userId, provider: event.provider, scopes: [...exchanged.scopes], accountLabel: exchanged.scope ? `${exchanged.accountLabel} (${exchanged.scope})` : exchanged.accountLabel });
  await storeConnectionSecret(deps.db, connection.id, exchanged.token);
  return { connected: true, accountLabel: connection.accountLabel };
}

/** The owner revoked from the settings page; the worker drops the token it alone can reach. */
export async function dropRevokedSecret(deps: WorkerDeps, userId: string, provider: "github" | "vercel" | "gmail" | "stripe" | "meta_ads"): Promise<{ readonly dropped: boolean }> {
  const connection = await getConnection(deps.db, userId, provider);
  if (!connection || connection.status === "connected") return { dropped: false };
  await dropConnectionSecret(deps.db, connection.id);
  return { dropped: true };
}
