import { z } from "zod";
import { ArtifactPathError, artifactPathBelongs, ARTIFACTS_BUCKET } from "./artifacts";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { EXPORTS_BUCKET, exportStoragePath } from "./exports";
import { UuidSchema } from "./json";
import { readAllPages } from "./paging";

/**
 * RET-1 (ADR 0016): the purge is the one delete path in North. The worker
 * marks the purge first (`beginPurge`: from then on the entitlement stays
 * ended, M6 review M5), removes the user's storage objects
 * (`listUserStoragePaths`) and task workspaces (`listUserTaskIds`), calls
 * `purgeOwner` (the `purge_owner` function: service role only, refused before
 * `retention_until`), then `auth.admin.deleteUser`, which has nothing left to
 * cascade into. Every listing pages past PostgREST's 1000 rows.
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

/** True for the database's refusal to change an entitlement while its purge runs (`entitlements_purge_hold`, hint `purge_running`). */
export const isPurgeRunning = (error: unknown): boolean => {
  const cause = error instanceof DbError ? error.cause : error;
  return z.object({ code: z.literal("23514"), hint: z.literal("purge_running") }).safeParse(cause).success;
};

/**
 * Service role only: `purge_begin` checks `purge_owner`'s condition under the
 * owner lock and stamps `purge_started_at` once (a second call returns the
 * same time). Nothing reactivates the entitlement afterwards; call it before
 * removing a single object. `PurgeRefusedError` before `retention_until`.
 */
export async function beginPurge(db: DbClient, userId: string): Promise<string> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.rpc("purge_begin", { p_user_id: id });
  if (error) {
    if (isRefusal(error)) throw new PurgeRefusedError(`Purge refused for ${id}: ${error.message}`, error);
    throw dbError("Could not begin the purge", error);
  }
  return new Date(z.string().parse(data)).toISOString();
}

/** When the user's purge began, or null when none has (the reactivation path asks before it changes the entitlement). */
export async function purgeStartedAt(db: DbClient, userId: string): Promise<string | null> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.from("entitlements").select("purge_started_at").eq("user_id", id).maybeSingle();
  if (error) throw dbError("Could not read the purge mark", error);
  return data?.purge_started_at ? new Date(data.purge_started_at).toISOString() : null;
}

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

async function ownerCompanyIds(db: DbClient, userId: string): Promise<readonly string[]> {
  const rows = await readAllPages((from, to) => db.from("companies").select("id").eq("owner_id", userId).order("id", { ascending: true }).range(from, to), "Could not list the owner's companies");
  return rows.map((c) => c.id);
}

/** One company's artifact objects; a row whose path leaves the company's folder is refused (M6 review M2), never listed for deletion. */
async function companyArtifactRefs(db: DbClient, companyId: string): Promise<readonly StorageObjectRef[]> {
  const rows = await readAllPages(
    (from, to) => db.from("artifacts").select("id, company_id, storage_path").eq("company_id", companyId).order("id", { ascending: true }).range(from, to),
    "Could not list the owner's artifacts",
  );
  return rows.map((a) => {
    if (a.company_id !== companyId || !artifactPathBelongs(companyId, a.storage_path)) throw new ArtifactPathError(a.id, a.storage_path);
    return Object.freeze({ bucket: ARTIFACTS_BUCKET, path: a.storage_path });
  });
}

/** Service role: the user's storage objects (every artifact version of every company, every export's zip) for the worker to remove before the purge. */
export async function listUserStoragePaths(db: DbClient, userId: string): Promise<readonly StorageObjectRef[]> {
  const id = UuidSchema.parse(userId);
  const artifacts: StorageObjectRef[] = [];
  for (const companyId of await ownerCompanyIds(db, id)) artifacts.push(...(await companyArtifactRefs(db, companyId)));
  const exports = await readAllPages((from, to) => db.from("exports").select("id").eq("user_id", id).order("id", { ascending: true }).range(from, to), "Could not list the owner's exports");
  return Object.freeze([...artifacts, ...exports.map((e) => Object.freeze({ bucket: EXPORTS_BUCKET, path: exportStoragePath(id, e.id) }))]);
}

/** Service role: every task id of the user's companies, for the worker to remove `WORKSPACE_ROOT/<taskId>` before the purge. */
export async function listUserTaskIds(db: DbClient, userId: string): Promise<readonly string[]> {
  const id = UuidSchema.parse(userId);
  const ids: string[] = [];
  for (const companyId of await ownerCompanyIds(db, id)) {
    const rows = await readAllPages((from, to) => db.from("tasks").select("id").eq("company_id", companyId).order("id", { ascending: true }).range(from, to), "Could not list the owner's tasks");
    ids.push(...rows.map((t) => t.id));
  }
  return Object.freeze(ids);
}
