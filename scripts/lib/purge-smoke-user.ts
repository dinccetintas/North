/**
 * ADR 0016's smoke cleanup, shared by smoke M1–M4, the LLM smoke and the
 * staging e2e purge (STG-1). A test owner cannot be removed with
 * `auth.admin.deleteUser`: the cascade reaches append-only tables
 * (`credit_entries` first; Task 17 found every smoke's delete failing
 * silently). So the harness does what the ADR says: with the service role it
 * already holds it ends the owner's entitlement and puts `retention_until`
 * behind the database's clock, then purges through the worker's one delete
 * path (`purgeOwner`: the purge mark, storage objects, task workspaces when a
 * root is given, the `purge_owner` function with a reason label that
 * `purge_log` records, then the auth user, which has nothing left to cascade
 * into). Test owners only: on a real user it would end the entitlement and
 * delete every row the user owns.
 */
import { z } from "zod";
import { PurgeReasonSchema, type DbClient } from "@north/db";
import { PURGE_CLOCK_MARGIN_MS, purgeOwner, type PurgeResult } from "../../apps/worker/src/services/purge";

/** How far behind the script's clock `retention_until` goes: five times the worker's margin, so a database clock minutes behind still lets `purge_owner` run. */
export const RETENTION_PAST_MS = 5 * PURGE_CLOCK_MARGIN_MS;

/** The entitlement columns the purge condition reads (`entitlements_ended_has_dates` needs both dates on an ended row). */
export interface PurgeReadyPatch {
  readonly status: "ended";
  readonly ended_at: string;
  readonly retention_until: string;
}

/** The entitlement a purge accepts as of `now`: ended, retention passed by `RETENTION_PAST_MS`. */
export function purgeReadyPatch(now: Date): PurgeReadyPatch {
  const past = new Date(now.getTime() - RETENTION_PAST_MS).toISOString();
  return Object.freeze({ status: "ended", ended_at: past, retention_until: past });
}

export interface PurgeTestUserOptions {
  /** The worker's `WORKSPACE_ROOT` when the script runs where the workspaces live; without it they stay on disk (`purge-due.ts` does the same). */
  readonly workspaceRoot?: string;
  readonly now?: () => Date;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Ends the test owner's entitlement and purges them through the worker's
 * `purgeOwner`. Throws, naming the user, when the update or the purge is
 * refused; a user already purged only has the auth user deleted again.
 */
export async function purgeTestUser(db: DbClient, userId: string, reason: string, options: PurgeTestUserOptions = {}): Promise<PurgeResult> {
  const id = z.uuid().parse(userId);
  const label = PurgeReasonSchema.parse(reason);
  const now = options.now ?? (() => new Date());
  const { error } = await db.from("entitlements").update(purgeReadyPatch(now())).eq("user_id", id);
  if (error) throw new Error(`could not end the entitlement of ${id}: ${error.message}`);
  const deps = options.workspaceRoot ? { db, env: { WORKSPACE_ROOT: options.workspaceRoot } } : { db };
  return purgeOwner(deps, id, label, now);
}

/** One line for the log: rows per table summed, objects, the auth user. */
export function purgeSummary(result: PurgeResult): string {
  const rows = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
  return `${rows} row(s), ${result.objectsRemoved} storage object(s), auth user ${result.authUserDeleted ? "deleted" : "already gone"}`;
}

/**
 * A smoke's last step: purges its owner and prints one line. A failure is a
 * warning naming the user and the cause (the smoke's verdict stands, its rows
 * stay for inspection), never an exception. True when the owner was purged.
 */
export async function purgeSmokeUser(db: DbClient, userId: string, reason = "smoke"): Promise<boolean> {
  try {
    const result = await purgeTestUser(db, userId, reason);
    console.log(`purged the smoke user ${userId}: ${purgeSummary(result)}`);
    return true;
  } catch (error) {
    const cause = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : messageOf(error);
    console.warn(`could not purge the smoke user ${userId} (${cause}); its rows stay in the database`);
    return false;
  }
}
