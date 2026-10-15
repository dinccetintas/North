import { providerForAction, type ActionKind, type ConnectionProvider, type ProviderToken } from "@north/core";
import { companyOwnerId, getConnection, readConnectionSecret, SANDBOX_SCOPE, setConnectionStatus, storeConnectionSecret, type ConnectionRecord } from "@north/db";
import type { ProviderAuth } from "@north/integrations";
import type { WorkerDeps } from "../deps";
import { oauthClients, parseProviderToken, refreshGoogleToken, serializeProviderToken, timedFetch, type FetchLike } from "./oauth-providers";

/** Thrown when a live action needs an account the user has not connected (ONB-3: becomes a connect card, never a crash). */
export class ConnectionRequiredError extends Error {
  constructor(
    readonly provider: ConnectionProvider,
    readonly kind: ActionKind,
  ) {
    super(`${provider} is not connected; ${kind} needs it`);
    this.name = "ConnectionRequiredError";
  }
}

/** Vercel keeps the team a token was installed on as a `team:<id>` scope entry; the account label is display-only. */
export const TEAM_SCOPE_PREFIX = "team:";
export const teamScopeOf = (scopes: readonly string[]): string | undefined => scopes.find((s) => s.startsWith(TEAM_SCOPE_PREFIX))?.slice(TEAM_SCOPE_PREFIX.length);

/** Providers the worker holds tokens for (ADR 0010); Stripe arrives with M6. */
const LIVE_PROVIDERS: ReadonlySet<ConnectionProvider> = new Set(["github", "vercel", "meta_ads", "gmail"]);

/** A Google access token is refreshed when it expires within this many seconds. */
export const REFRESH_WINDOW_MS = 60_000;

export interface ProviderAuthOptions {
  readonly fetchImpl?: FetchLike;
  readonly now?: () => Date;
}

const needsRefresh = (token: ProviderToken, now: Date): boolean => typeof token !== "string" && token.expiresAt !== undefined && Date.parse(token.expiresAt) - now.getTime() <= REFRESH_WINDOW_MS;

/**
 * The usable access token of a connection: the stored secret parsed as
 * `ProviderTokenSchema`; a Google token within 60 s of its expiry is refreshed
 * with the refresh token and re-stored under the same key, so the next read
 * finds it fresh. Throws when the secret is unreadable, malformed or cannot be
 * refreshed; the caller marks the row and asks the user to connect again.
 */
export async function readProviderToken(deps: WorkerDeps, provider: ConnectionProvider, connection: Pick<ConnectionRecord, "id">, opts: ProviderAuthOptions = {}): Promise<string> {
  const now = opts.now ?? (() => new Date());
  const token = parseProviderToken(await readConnectionSecret(deps.db, connection.id));
  if (!token) throw new Error("stored token is not a ProviderToken");
  if (typeof token === "string") return token;
  if (!needsRefresh(token, now())) return token.accessToken;
  if (provider !== "gmail" || !token.refreshToken) throw new Error(`${provider} token expired and cannot be refreshed`);
  const client = oauthClients(process.env).gmail;
  if (!client) throw new Error("Google OAuth client is not configured on the worker");
  const refreshed = await refreshGoogleToken(client, token.refreshToken, opts.fetchImpl ?? timedFetch, now);
  await storeConnectionSecret(deps.db, connection.id, serializeProviderToken(refreshed));
  return typeof refreshed === "string" ? refreshed : refreshed.accessToken;
}

/** The auth shape each live adapter reads: token only (GitHub), team scope (Vercel), `act:`/`page:` scopes (Meta), mailbox label (Gmail). */
function authShape(provider: ConnectionProvider, connection: Pick<ConnectionRecord, "scopes" | "accountLabel">, token: string): ProviderAuth {
  switch (provider) {
    case "vercel": {
      const scope = teamScopeOf(connection.scopes);
      return Object.freeze({ token, ...(scope ? { scope } : {}) });
    }
    case "meta_ads":
      return Object.freeze({ token, scopes: Object.freeze([...connection.scopes]) });
    case "gmail":
      return Object.freeze({ token, ...(connection.accountLabel ? { account: connection.accountLabel } : {}) });
    default:
      return Object.freeze({ token });
  }
}

/**
 * Credentials for a user-owned provider (ADR 0008, ADR 0010): sandbox mode
 * needs none; live mode decrypts the owner's token inside the worker and hands
 * it to the adapter only. A sandbox-scoped row, a missing, unreadable or
 * unrefreshable secret all count as "not connected" (the row is marked `error`
 * so the settings page says so). Actions without a provider return null.
 */
export async function providerAuthFor(deps: WorkerDeps, companyId: string, kind: ActionKind, opts: ProviderAuthOptions = {}): Promise<ProviderAuth | null> {
  const provider = providerForAction(kind);
  if (!provider || deps.integrations.mode === "sandbox" || !LIVE_PROVIDERS.has(provider)) return null;
  const ownerId = await companyOwnerId(deps.db, companyId);
  const connection = await getConnection(deps.db, ownerId, provider);
  if (!connection || connection.status !== "connected" || connection.scopes.includes(SANDBOX_SCOPE)) throw new ConnectionRequiredError(provider, kind);
  try {
    return authShape(provider, connection, await readProviderToken(deps, provider, connection, opts));
  } catch (cause) {
    console.error(`[connections] ${provider} token unusable for connection ${connection.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    await setConnectionStatus(deps.db, connection.id, "error");
    throw new ConnectionRequiredError(provider, kind);
  }
}
