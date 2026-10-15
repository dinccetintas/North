import { providerForAction, type ActionKind, type ConnectionProvider } from "@north/core";
import { companyOwnerId, getConnection, readConnectionSecret, SANDBOX_SCOPE, setConnectionStatus } from "@north/db";
import type { ProviderAuth } from "@north/integrations";
import type { WorkerDeps } from "../deps";

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

/**
 * Credentials for a user-owned provider (ADR 0008): sandbox mode needs none;
 * live mode decrypts the owner's token inside the worker and hands it to the
 * adapter only. A sandbox-scoped row, a missing or unreadable secret all count
 * as "not connected" (the row is marked `error` so the settings page says so).
 * Platform providers (mail, push, ads in M2) are configured by env and return
 * null here.
 */
export async function providerAuthFor(deps: WorkerDeps, companyId: string, kind: ActionKind): Promise<ProviderAuth | null> {
  const provider = providerForAction(kind);
  if (!provider || deps.integrations.mode === "sandbox") return null;
  if (provider !== "github" && provider !== "vercel") return null;
  const ownerId = await companyOwnerId(deps.db, companyId);
  const connection = await getConnection(deps.db, ownerId, provider);
  if (!connection || connection.status !== "connected" || connection.scopes.includes(SANDBOX_SCOPE)) throw new ConnectionRequiredError(provider, kind);
  let token: string;
  try {
    token = await readConnectionSecret(deps.db, connection.id);
  } catch (cause) {
    console.error(`[connections] ${provider} token unreadable for connection ${connection.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    await setConnectionStatus(deps.db, connection.id, "error");
    throw new ConnectionRequiredError(provider, kind);
  }
  const scope = provider === "vercel" ? teamScopeOf(connection.scopes) : undefined;
  return Object.freeze({ token, ...(scope ? { scope } : {}) });
}
