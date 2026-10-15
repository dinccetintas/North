import { listActionsByKind, listExports, type CompanySummary, type DbClient } from "@north/db";
import type { ExportLike, RepoRef } from "./export-view";

/**
 * EXP-1 reads for `/settings/export`, as the owner. The worker writes the
 * zip and the row; the web lists rows and signs a URL on click.
 *
 * Repositories used: `listExports(db, userId)` (WP-A6) → newest first;
 * `listActionsByKind(db, companyId, "repo.create", days)` (M3) for the
 * repository each company's code already lives in.
 */

/** A repository is created once, at the first build; a year covers every company the founder still runs. */
const REPO_LOOKBACK_DAYS = 365;

/** The latest executed `repo.create` reference of each company (null before the first build). */
export async function loadRepoRefs(db: DbClient, companies: readonly Pick<CompanySummary, "id" | "name">[]): Promise<readonly RepoRef[]> {
  return Promise.all(
    companies.map(async (c) => {
      const actions = await listActionsByKind(db, c.id, "repo.create", REPO_LOOKBACK_DAYS);
      const executed = actions.find((a) => a.status === "executed" && a.externalRef !== null);
      return Object.freeze({ companyId: c.id, name: c.name, ref: executed?.externalRef ?? null });
    }),
  );
}

export async function loadExports(db: DbClient, userId: string): Promise<readonly ExportLike[]> {
  const rows = await listExports(db, userId);
  return rows.map((r) => Object.freeze({ id: r.id, kind: r.kind, companyId: r.companyId ?? null, status: r.status, bytes: r.bytes ?? null, expiresAt: r.expiresAt ?? null, createdAt: r.createdAt }));
}
