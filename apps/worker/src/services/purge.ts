import { z } from "zod";
import type { Entitlement } from "@north/core";
import { getEntitlement, getProfile, listUserStoragePaths, purgeOwner as purgeOwnerRows, PurgeReasonSchema, PurgeRefusedError, type PurgeCounts, type StorageObjectRef } from "@north/db";
import type { WorkerDeps } from "../deps";

/**
 * RET-1 (ADR 0016): the one delete path, worker side. In this order: the
 * user's storage objects (every artifact version, every export zip), then the
 * `purge_owner` function (service role; it refuses before `retention_until`
 * and writes `purge_log`), then `auth.admin.deleteUser`, which has nothing
 * left to cascade into. Storage goes first because afterwards no row names
 * the objects any more; so the worker first checks the function's own
 * condition and never empties a bucket for a purge the database would refuse.
 */

/** The function decides on the database's clock, so the pre-check reads wall time (never the simulated worker clock) with this margin. */
export const PURGE_CLOCK_MARGIN_MS = 60_000;
const REMOVE_BATCH = 100;

export interface PurgeResult {
  readonly userId: string;
  readonly objectsRemoved: number;
  /** Rows deleted per table, as `purge_log` recorded them; empty when an earlier run had already purged the rows. */
  readonly counts: PurgeCounts;
  readonly authUserDeleted: boolean;
  readonly alreadyPurged: boolean;
}

/** `purge_owner`'s condition: `ended` and `retention_until` passed (by the margin). */
export function purgeAllowed(entitlement: Pick<Entitlement, "status" | "retentionUntil">, wallNow: Date): boolean {
  return entitlement.status === "ended" && entitlement.retentionUntil !== null && Date.parse(entitlement.retentionUntil) <= wallNow.getTime() - PURGE_CLOCK_MARGIN_MS;
}

/** Removes the objects bucket by bucket in batches; a storage error stops the purge before any row is touched. */
async function removeObjects(deps: Pick<WorkerDeps, "db">, refs: readonly StorageObjectRef[]): Promise<number> {
  let removed = 0;
  for (const bucket of new Set(refs.map((r) => r.bucket))) {
    const paths = refs.filter((r) => r.bucket === bucket).map((r) => r.path);
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const { data, error } = await deps.db.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH));
      if (error) throw new Error(`purge: could not remove ${bucket} objects: ${error.message}`);
      removed += data?.length ?? 0;
    }
  }
  return removed;
}

/** True when the auth user was deleted, false when it was already gone; any other refusal throws. */
async function deleteAuthUser(deps: Pick<WorkerDeps, "db">, userId: string): Promise<boolean> {
  const { error } = await deps.db.auth.admin.deleteUser(userId);
  if (!error) return true;
  if (error.status === 404 || /not found/i.test(error.message)) return false;
  throw new Error(`purge: auth.admin.deleteUser failed (${error.status ?? "?"}): ${error.message}`);
}

/**
 * Purges one owner. Throws `PurgeRefusedError` before anything is removed
 * when the entitlement is not ended or `retention_until` has not passed. A
 * second call after a completed purge (or one that stopped before the auth
 * user) only finishes the auth deletion.
 */
export async function purgeOwner(deps: Pick<WorkerDeps, "db">, userId: string, reason: string, wallNow: () => Date = () => new Date()): Promise<PurgeResult> {
  const id = z.uuid().parse(userId);
  const label = PurgeReasonSchema.parse(reason);
  const entitlement = await getEntitlement(deps.db, id);
  if (!entitlement) {
    if (await getProfile(deps.db, id)) throw new PurgeRefusedError(`Purge refused for ${id}: the user has no entitlement`);
    return Object.freeze({ userId: id, objectsRemoved: 0, counts: Object.freeze({}), authUserDeleted: await deleteAuthUser(deps, id), alreadyPurged: true });
  }
  if (!purgeAllowed(entitlement, wallNow())) throw new PurgeRefusedError(`Purge refused for ${id}: the entitlement is ${entitlement.status} and retention_until is ${entitlement.retentionUntil ?? "unset"}`);
  const objectsRemoved = await removeObjects(deps, await listUserStoragePaths(deps.db, id));
  const counts = await purgeOwnerRows(deps.db, id, label);
  const authUserDeleted = await deleteAuthUser(deps, id);
  return Object.freeze({ userId: id, objectsRemoved, counts, authUserDeleted, alreadyPurged: false });
}
