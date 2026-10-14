import { providerForAction, type ActionKind, type ConnectionProvider } from "@north/core";
import { companyOwnerId, getConnection, readConnectionSecret } from "@north/db";
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

/**
 * Credentials for a user-owned provider (ADR 0008): sandbox mode needs none;
 * live mode decrypts the owner's token inside the worker and hands it to the
 * adapter only. Platform providers (mail, push, ads in M2) are configured by
 * env and return null here.
 */
export async function providerAuthFor(deps: WorkerDeps, companyId: string, kind: ActionKind): Promise<ProviderAuth | null> {
  const provider = providerForAction(kind);
  if (!provider || deps.integrations.mode === "sandbox") return null;
  if (provider !== "github" && provider !== "vercel") return null;
  const ownerId = await companyOwnerId(deps.db, companyId);
  const connection = await getConnection(deps.db, ownerId, provider);
  if (!connection || connection.status !== "connected") throw new ConnectionRequiredError(provider, kind);
  const token = await readConnectionSecret(deps.db, connection.id);
  return Object.freeze({ token, ...(connection.accountLabel ? { scope: connection.accountLabel } : {}) });
}
