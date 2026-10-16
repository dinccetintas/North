import { archiveCompany, EXPORTS_BUCKET, listCompaniesByOwner, listExpiredExports, listRetentionDue, PurgeRefusedError, setExportExpired, setPurgeDue, type PurgeCounts } from "@north/db";
import type { WorkerDeps } from "../deps";
import { purgeOwner } from "./purge";
import { directSteps, type StepRunner } from "./steps";

/**
 * RET-1 (ADR 0016), daily (and on `retention/tick`): expired export zips are
 * removed and their rows marked `expired`; every `ended` owner whose
 * `retention_until` has passed on the worker clock gets their companies
 * archived (`paused_reason: retention`) and `purge_due` set. It deletes
 * nothing else on its own: the purge runs only with
 * `RETENTION_PURGE_ENABLED=1`, and `purgeOwner` still re-checks the date on
 * the database's clock before it removes a single object.
 */

export const RETENTION_PURGE_REASON = "retention";

type Deps = Pick<WorkerDeps, "db" | "env" | "clock">;

export interface Marked {
  /** Companies archived by this sweep. */
  readonly archived: readonly string[];
  /** Archived companies whose kill switch was still off: the function sends `company/killswitch` for them. */
  readonly stopped: readonly string[];
  /** Owners flagged `purge_due` by this sweep. */
  readonly purgeDue: readonly string[];
  /** Every owner past retention (flagged now or earlier): the purge candidates. */
  readonly due: readonly string[];
}

export type PurgeAttempt = { readonly userId: string; readonly counts: PurgeCounts } | { readonly userId: string; readonly skipped: string };

export interface RetentionSweepResult extends Omit<Marked, "due"> {
  readonly exportsRemoved: readonly string[];
  readonly purged: readonly { readonly userId: string; readonly counts: PurgeCounts }[];
  readonly purgeSkipped: readonly { readonly userId: string; readonly skipped: string }[];
}

export const purgeEnabled = (env: Pick<WorkerDeps["env"], "RETENTION_PURGE_ENABLED">): boolean => env.RETENTION_PURGE_ENABLED === "1";

/** Ready exports past `expires_at`: the object goes, the row stays as `expired`. An object that cannot be removed now is retried tomorrow. */
export async function expireExports(deps: Deps): Promise<readonly string[]> {
  const removed: string[] = [];
  for (const record of await listExpiredExports(deps.db, deps.clock())) {
    if (record.storagePath) {
      const { error } = await deps.db.storage.from(EXPORTS_BUCKET).remove([record.storagePath]);
      if (error) {
        console.warn(`[retention] export ${record.id}: object not removed (${error.message}); retried on the next sweep`);
        continue;
      }
    }
    await setExportExpired(deps.db, record.id);
    removed.push(record.id);
  }
  return Object.freeze(removed);
}

/** Archive and flag every owner past retention; idempotent (an archived company and a set flag are left as they are). */
export async function archiveRetentionDue(deps: Deps): Promise<Marked> {
  const archived: string[] = [];
  const stopped: string[] = [];
  const purgeDue: string[] = [];
  const due: string[] = [];
  for (const entitlement of await listRetentionDue(deps.db, deps.clock())) {
    due.push(entitlement.userId);
    for (const company of await listCompaniesByOwner(deps.db, entitlement.userId)) {
      if (company.status === "archived") continue;
      await archiveCompany(deps.db, company.id);
      archived.push(company.id);
      if (!company.killSwitchActive) stopped.push(company.id);
    }
    if (!entitlement.purgeDue) {
      await setPurgeDue(deps.db, entitlement.userId, true);
      purgeDue.push(entitlement.userId);
    }
  }
  return Object.freeze({ archived: Object.freeze(archived), stopped: Object.freeze(stopped), purgeDue: Object.freeze(purgeDue), due: Object.freeze(due) });
}

/** One purge; a refusal (the database clock says not yet) is a skip, not a failure. */
export async function purgeDueOwner(deps: Deps, userId: string): Promise<PurgeAttempt> {
  try {
    const result = await purgeOwner(deps, userId, RETENTION_PURGE_REASON);
    return { userId, counts: result.counts };
  } catch (error) {
    if (error instanceof PurgeRefusedError) return { userId, skipped: error.message };
    throw error;
  }
}

/** The sweep as durable steps: `exports`, `archive`, then `purge-<userId>` per owner when the purge is enabled. */
export async function retentionSweep(deps: Deps, step: StepRunner = directSteps): Promise<RetentionSweepResult> {
  const exportsRemoved = await step.run("exports", () => expireExports(deps));
  const marked = await step.run("archive", () => archiveRetentionDue(deps));
  const attempts: PurgeAttempt[] = [];
  if (purgeEnabled(deps.env)) {
    for (const userId of marked.due) attempts.push(await step.run(`purge-${userId}`, () => purgeDueOwner(deps, userId)));
  }
  return Object.freeze({
    exportsRemoved,
    archived: marked.archived,
    stopped: marked.stopped,
    purgeDue: marked.purgeDue,
    purged: attempts.flatMap((a) => ("counts" in a ? [a] : [])),
    purgeSkipped: attempts.flatMap((a) => ("skipped" in a ? [a] : [])),
  });
}
