import { z } from "zod";
import { ARTIFACTS_BUCKET } from "./artifacts";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { EXPORTS_BUCKET, exportStoragePath } from "./exports";
import { UuidSchema } from "./json";

/**
 * RET-1 (ADR 0016): the purge is the one delete path in North. The worker (and
 * the smoke harnesses) remove the user's storage objects first
 * (`listUserStoragePaths`), call `purgeOwner` (the `purge_owner` function:
 * service role only, refused before `retention_until`), then
 * `auth.admin.deleteUser`, which has nothing left to cascade into.
 */
export const PurgeReasonSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, "a lowercase label such as retention, smoke or erasure");

/** Rows deleted per table, as written to `purge_log`. */
export type PurgeCounts = Readonly<Record<string, number>>;

/** The function refused: the entitlement is not `ended`, or `retention_until` has not passed. */
export class PurgeRefusedError extends DbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "PurgeRefusedError";
  }
}

const isRefusal = (error: unknown): boolean => z.object({ code: z.literal("23514"), hint: z.literal("retention_not_passed") }).safeParse(error).success;

/** Service role only: deletes every row of the user in one transaction and returns the counts it logged. */
export async function purgeOwner(db: DbClient, userId: string, reason: string): Promise<PurgeCounts> {
  const id = UuidSchema.parse(userId);
  const r = PurgeReasonSchema.parse(reason);
  const { data, error } = await db.rpc("purge_owner", { p_user_id: id, p_reason: r });
  if (error) {
    if (isRefusal(error)) throw new PurgeRefusedError(`Purge refused for ${id}: ${error.message}`, error);
    throw dbError("Could not purge owner", error);
  }
  return Object.freeze(z.record(z.string(), z.number().int().nonnegative()).parse(data));
}

export interface StorageObjectRef {
  readonly bucket: typeof ARTIFACTS_BUCKET | typeof EXPORTS_BUCKET;
  readonly path: string;
}

/** Service role: the user's storage objects (every artifact version of every company, every export's zip) for the worker to remove before the purge. */
export async function listUserStoragePaths(db: DbClient, userId: string): Promise<readonly StorageObjectRef[]> {
  const id = UuidSchema.parse(userId);
  const companies = await db.from("companies").select("id").eq("owner_id", id);
  if (companies.error) throw dbError("Could not list the owner's companies", companies.error);
  const companyIds = (companies.data ?? []).map((c) => c.id);
  const artifacts = companyIds.length === 0 ? { data: [], error: null } : await db.from("artifacts").select("storage_path").in("company_id", companyIds);
  if (artifacts.error) throw dbError("Could not list the owner's artifacts", artifacts.error);
  const exports = await db.from("exports").select("id").eq("user_id", id);
  if (exports.error) throw dbError("Could not list the owner's exports", exports.error);
  return Object.freeze([
    ...(artifacts.data ?? []).map((a) => Object.freeze({ bucket: ARTIFACTS_BUCKET, path: a.storage_path })),
    ...(exports.data ?? []).map((e) => Object.freeze({ bucket: EXPORTS_BUCKET, path: exportStoragePath(id, e.id) })),
  ]);
}
