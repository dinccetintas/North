import type { ConnectionOauthCodeEvent, ConnectionProvider } from "@north/core";
import { dropConnectionSecret, getConnection, readConnectionSecret, setConnectionStatus, storeConnectionSecret, upsertConnection } from "@north/db";
import type { WorkerDeps } from "../deps";
import { exchangeGithubCode, exchangeGoogleCode, exchangeMetaCode, exchangeStripeCode, exchangeVercelCode, oauthClients, revokeProviderToken, serializeProviderToken, timedFetch, type ExchangedToken, type FetchLike, type OauthClient, type OauthClientProvider } from "./oauth-providers";
import { TEAM_SCOPE_PREFIX } from "./provider-auth";

export { exchangeGithubCode, exchangeGoogleCode, exchangeMetaCode, exchangeStripeCode, exchangeVercelCode, oauthClients, parseProviderToken, refreshGoogleToken, revokeProviderToken, serializeProviderToken, timedFetch, type ExchangedToken, type FetchLike, type OauthClient } from "./oauth-providers";

type Exchange = (client: OauthClient, code: string, redirectUri: string, fetchImpl: FetchLike) => Promise<ExchangedToken>;

const EXCHANGES: Readonly<Record<OauthClientProvider, Exchange>> = Object.freeze({
  github: exchangeGithubCode,
  vercel: exchangeVercelCode,
  meta_ads: exchangeMetaCode,
  gmail: exchangeGoogleCode,
  stripe: exchangeStripeCode,
});

const isOauthProvider = (provider: ConnectionProvider): provider is OauthClientProvider => provider in EXCHANGES;

/**
 * ONB-3: completes a connection from the one-time code the web callback
 * forwarded. The row is written as `error` first, the token is encrypted and
 * stored by the service role, then the row becomes `connected`: a row never
 * says "connected" without a secret behind it. The account label is for
 * display; a Vercel team id travels as a `team:<id>` scope, Meta's ad account
 * and page as `act:<id>` / `page:<id>` (ADR 0010).
 */
export async function completeConnection(deps: WorkerDeps, event: ConnectionOauthCodeEvent, fetchImpl: FetchLike = timedFetch): Promise<{ readonly connected: boolean; readonly accountLabel: string }> {
  const client = oauthClients(process.env)[event.provider];
  if (!client) throw new Error(`${event.provider} OAuth is not configured on the worker (client id and secret)`);
  let exchanged: ExchangedToken;
  try {
    exchanged = await EXCHANGES[event.provider](client, event.code, event.redirectUri, fetchImpl);
  } catch (cause) {
    await upsertConnection(deps.db, { userId: event.userId, provider: event.provider, scopes: [], accountLabel: "", status: "error" });
    throw cause;
  }
  const scopes = [...exchanged.scopes, ...(exchanged.scope ? [`${TEAM_SCOPE_PREFIX}${exchanged.scope}`] : [])];
  const connection = await upsertConnection(deps.db, { userId: event.userId, provider: event.provider, scopes, accountLabel: exchanged.accountLabel, status: "error" });
  await storeConnectionSecret(deps.db, connection.id, serializeProviderToken(exchanged.token));
  await setConnectionStatus(deps.db, connection.id, "connected");
  return { connected: true, accountLabel: connection.accountLabel };
}

/** The owner revoked from the settings page; the worker revokes at the provider when it can and drops the token it alone can reach. */
export async function dropRevokedSecret(deps: WorkerDeps, userId: string, provider: ConnectionProvider, fetchImpl: FetchLike = timedFetch): Promise<{ readonly dropped: boolean; readonly revokedAtProvider: boolean }> {
  const connection = await getConnection(deps.db, userId, provider);
  if (!connection || connection.status === "connected") return { dropped: false, revokedAtProvider: false };
  let revokedAtProvider = false;
  if (isOauthProvider(provider)) {
    try {
      const secret = await readConnectionSecret(deps.db, connection.id);
      revokedAtProvider = await revokeProviderToken(provider, oauthClients(process.env)[provider], secret, fetchImpl);
    } catch (cause) {
      // No secret (sandbox row, already dropped) or the provider refused: the ciphertext still goes.
      console.error(`[connections] ${provider} revoke at provider skipped: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  await dropConnectionSecret(deps.db, connection.id);
  return { dropped: true, revokedAtProvider };
}
