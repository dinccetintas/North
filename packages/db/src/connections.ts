import { CONNECTION_PROVIDERS, CONNECTION_STATUSES, type ConnectionProvider, type ConnectionStatus } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";
import { ConnectionSecretError, encryptionKey, openSecret, sealSecret } from "./secrets";

/** What the owner sees about a connected account; never the token. */
export interface ConnectionRecord {
  readonly id: string;
  readonly userId: string;
  readonly provider: ConnectionProvider;
  readonly status: ConnectionStatus;
  readonly scopes: readonly string[];
  readonly accountLabel: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const UpsertConnectionInputSchema = z.object({
  userId: UuidSchema,
  provider: z.enum(CONNECTION_PROVIDERS),
  scopes: z.array(z.string().min(1).max(100)).max(50).default([]),
  accountLabel: z.string().trim().max(200).default(""),
  /** `error` while a token is being exchanged or after a failed one; flipped to `connected` by `setConnectionStatus`. */
  status: z.enum(["connected", "error"]).default("connected"),
});

/** Marks a connection that carries no real token: recorded by the owner in sandbox mode, never usable by the live adapters. */
export const SANDBOX_SCOPE = "sandbox";
export type UpsertConnectionInput = z.input<typeof UpsertConnectionInputSchema>;

const CONNECTION_COLUMNS = "id, user_id, provider, status, scopes, account_label, created_at, updated_at";

const ConnectionRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  provider: z.enum(CONNECTION_PROVIDERS),
  status: z.enum(CONNECTION_STATUSES),
  scopes: z.array(z.string()),
  account_label: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const toRecord = (row: unknown): ConnectionRecord => {
  const r = ConnectionRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    status: r.status,
    scopes: Object.freeze([...r.scopes]),
    accountLabel: r.account_label,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
};

/** All of a user's connections, one per provider, oldest first. */
export async function listConnections(db: DbClient, userId: string): Promise<readonly ConnectionRecord[]> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.from("connections").select(CONNECTION_COLUMNS).eq("user_id", id).order("created_at", { ascending: true });
  if (error) throw dbError("Could not list connections", error);
  return Object.freeze((data ?? []).map(toRecord));
}

/** One provider's connection, or null when the user never connected it (a revoked one is returned with its status). */
export async function getConnection(db: DbClient, userId: string, provider: ConnectionProvider): Promise<ConnectionRecord | null> {
  const id = UuidSchema.parse(userId);
  const p = z.enum(CONNECTION_PROVIDERS).parse(provider);
  const { data, error } = await db.from("connections").select(CONNECTION_COLUMNS).eq("user_id", id).eq("provider", p).maybeSingle();
  if (error) throw dbError("Could not load connection", error);
  return data ? toRecord(data) : null;
}

/**
 * Creates or re-activates the provider row. Under RLS an owner may only write
 * a sandbox-scoped row (migration 0007); real connections are written by the
 * worker after the OAuth exchange.
 */
export async function upsertConnection(db: DbClient, input: UpsertConnectionInput): Promise<ConnectionRecord> {
  const c = UpsertConnectionInputSchema.parse(input);
  const { data, error } = await db
    .from("connections")
    .upsert({ user_id: c.userId, provider: c.provider, status: c.status, scopes: [...c.scopes], account_label: c.accountLabel }, { onConflict: "user_id,provider" })
    .select(CONNECTION_COLUMNS)
    .single();
  if (error || !data) throw dbError("Could not save connection", error);
  return toRecord(data);
}

/** Service role: `connected` once the secret is stored, `error` when the token cannot be read or exchanged. */
export async function setConnectionStatus(db: DbClient, connectionId: string, status: ConnectionStatus): Promise<void> {
  const id = UuidSchema.parse(connectionId);
  const s = z.enum(CONNECTION_STATUSES).parse(status);
  const { error } = await db.from("connections").update({ status: s }).eq("id", id);
  if (error) throw dbError("Could not update connection status", error);
}

/** Service role: drops every secret whose connection is no longer `connected` (safety net behind `connection/revoked`). Returns how many. */
export async function dropOrphanSecrets(db: DbClient): Promise<number> {
  const { data, error } = await db.from("connection_secrets").select("connection_id, connections!inner(status)").neq("connections.status", "connected");
  if (error) throw dbError("Could not list orphan secrets", error);
  const ids = (data ?? []).map((row) => (row as { connection_id: string }).connection_id);
  for (const id of ids) await dropConnectionSecret(db, id);
  return ids.length;
}

/**
 * Marks the connection revoked. The row stays so the settings page can offer
 * "Connect again". The secret is dropped by `dropConnectionSecret` (service
 * role); an owner's revoke emits `connection/revoked` and the worker drops it.
 */
export async function revokeConnection(db: DbClient, userId: string, provider: ConnectionProvider): Promise<string> {
  const id = UuidSchema.parse(userId);
  const p = z.enum(CONNECTION_PROVIDERS).parse(provider);
  const { data, error } = await db.from("connections").update({ status: "revoked" }).eq("user_id", id).eq("provider", p).select("id").maybeSingle();
  if (error) throw dbError("Could not revoke connection", error);
  if (!data) throw new DbError(`No ${p} connection for user ${id}`);
  return data.id;
}

/** Deletes the stored token (service role). Missing rows are fine; a permission error is not. */
export async function dropConnectionSecret(db: DbClient, connectionId: string): Promise<void> {
  const id = UuidSchema.parse(connectionId);
  const { error } = await db.from("connection_secrets").delete().eq("connection_id", id);
  if (error) throw dbError("Could not drop connection secret", error);
}

/**
 * Encrypts and stores the provider token (ADR 0008). Service role only: the
 * table has RLS on and no policies, so an owner client gets a `DbError`.
 */
export async function storeConnectionSecret(db: DbClient, connectionId: string, plaintext: string, keyEncoded: string | undefined = process.env.CONNECTIONS_ENCRYPTION_KEY): Promise<void> {
  const id = UuidSchema.parse(connectionId);
  const sealed = sealSecret(plaintext, encryptionKey(keyEncoded));
  const { error } = await db.from("connection_secrets").upsert({ connection_id: id, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag }, { onConflict: "connection_id" });
  if (error) throw dbError("Could not store connection secret", error);
}

/**
 * Decrypts the provider token for the worker's adapters. Throws
 * `ConnectionSecretError` when the key is wrong and `DbError` when no secret
 * row is visible (which is every caller but the service role).
 */
export async function readConnectionSecret(db: DbClient, connectionId: string, keyEncoded: string | undefined = process.env.CONNECTIONS_ENCRYPTION_KEY): Promise<string> {
  const id = UuidSchema.parse(connectionId);
  const key = encryptionKey(keyEncoded);
  const { data, error } = await db.from("connection_secrets").select("ciphertext, iv, tag").eq("connection_id", id).maybeSingle();
  if (error) throw dbError("Could not read connection secret", error);
  if (!data) throw new DbError(`No secret stored for connection ${id}`);
  return openSecret(data, key);
}

export { ConnectionSecretError };
