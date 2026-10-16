import type { Entitlement, ExportKind, ExportStatus } from "@north/core";
import { getEntitlement, getExport, listCompaniesByOwner, setExportFailed, setExportRunning, type CompanySummary, type DbClient, type ExportRecord } from "@north/db";
import type { WorkerDeps } from "../../deps";
import { exportDir, removeDir } from "./files";

/**
 * `build-export`'s first step (EXP-1, RET-1, ADR 0016). The export row is
 * loaded with the service role and must belong to the user the event names;
 * the companies are read through that row's `user_id`, never from the event.
 * An `ended` owner may export until `retention_until`; after it (or once
 * `purge_due`) the row fails with `archived`.
 */

/** The fixed messages a failed export row carries (`exports.error`). */
export const EXPORT_FAILURES = Object.freeze({
  archived: "archived",
  companyNotFound: "company not found",
  error: "The export could not be built. Request a new one.",
});

export interface PlannedCompany {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** The latest executed `repo.create` reference (EXP-1: the code is already theirs), or null before the first build. */
  readonly repoUrl: string | null;
}

export interface ExportPlan {
  readonly exportId: string;
  readonly userId: string;
  readonly kind: ExportKind;
  readonly companies: readonly PlannedCompany[];
}

export type ExportOutcome =
  | { readonly status: "ready"; readonly exportId: string; readonly bytes: number; readonly files: number; readonly expiresAt: string | null }
  | { readonly status: "failed"; readonly exportId: string; readonly error: string }
  | { readonly status: "not_found"; readonly exportId: string }
  | { readonly status: "skipped"; readonly exportId: string; readonly current: ExportStatus };

export type LoadResult = { readonly ok: true; readonly plan: ExportPlan } | { readonly ok: false; readonly outcome: ExportOutcome };

/** RET-1: open while the subscription runs, and after it ends until `retention_until`; never once the purge is due. */
export function exportAllowed(entitlement: Pick<Entitlement, "status" | "retentionUntil" | "purgeDue"> | null, now: Date): boolean {
  if (entitlement === null || entitlement.status !== "ended") return true;
  if (entitlement.purgeDue) return false;
  return entitlement.retentionUntil === null || Date.parse(entitlement.retentionUntil) > now.getTime();
}

/** One company (asked for by id, archived or not) or every company, archived ones only when the owner asked for them; null when the id is not the owner's. */
export function companiesFor(record: Pick<ExportRecord, "companyId" | "includeArchived">, owned: readonly CompanySummary[]): readonly CompanySummary[] | null {
  if (record.companyId !== null) {
    const one = owned.find((c) => c.id === record.companyId);
    return one ? [one] : null;
  }
  return owned.filter((c) => record.includeArchived || c.status !== "archived");
}

/** The repository the company's code lives in: the newest `repo.create` that ran (K1, so `notified`; `executed` accepted too). */
export async function repoUrlOf(db: DbClient, companyId: string): Promise<string | null> {
  const { data, error } = await db
    .from("actions")
    .select("external_ref, created_at")
    .eq("company_id", companyId)
    .eq("kind", "repo.create")
    .in("status", ["executed", "notified"])
    .not("external_ref", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the repository of ${companyId}: ${error.message}`);
  return data?.external_ref ?? null;
}

const failed = async (deps: Pick<WorkerDeps, "db">, exportId: string, error: string): Promise<LoadResult> => {
  await setExportFailed(deps.db, exportId, error);
  return { ok: false, outcome: { status: "failed", exportId, error } };
};

/** The `load` step: checks, then claims the row (`requested` → `running`; a `running` row is resumed after a crash), then plans. */
export async function loadExport(deps: Pick<WorkerDeps, "db" | "clock">, exportId: string, userId: string): Promise<LoadResult> {
  const record = await getExport(deps.db, exportId);
  if (!record || record.userId !== userId) return { ok: false, outcome: { status: "not_found", exportId } };
  if (record.status !== "requested" && record.status !== "running") return { ok: false, outcome: { status: "skipped", exportId, current: record.status } };
  if (!exportAllowed(await getEntitlement(deps.db, record.userId), deps.clock())) return failed(deps, exportId, EXPORT_FAILURES.archived);
  const companies = companiesFor(record, await listCompaniesByOwner(deps.db, record.userId));
  if (companies === null) return failed(deps, exportId, EXPORT_FAILURES.companyNotFound);
  if (record.status === "requested" && !(await setExportRunning(deps.db, exportId))) {
    const current = await getExport(deps.db, exportId);
    return { ok: false, outcome: { status: "skipped", exportId, current: current?.status ?? "failed" } };
  }
  const planned = await Promise.all(companies.map(async (c) => Object.freeze({ id: c.id, slug: c.slug, name: c.name, repoUrl: await repoUrlOf(deps.db, c.id) })));
  return { ok: true, plan: Object.freeze({ exportId, userId: record.userId, kind: record.kind, companies: Object.freeze(planned) }) };
}

/** `onFailure` (retries exhausted): the owner's row becomes `failed` with the fixed message and the scratch directory goes. */
export async function failExport(deps: Pick<WorkerDeps, "db" | "env">, exportId: string, userId: string): Promise<{ readonly failed: boolean }> {
  await removeDir(exportDir(deps, exportId));
  const record = await getExport(deps.db, exportId);
  if (!record || record.userId !== userId || (record.status !== "requested" && record.status !== "running")) return { failed: false };
  await setExportFailed(deps.db, exportId, EXPORT_FAILURES.error);
  return { failed: true };
}
