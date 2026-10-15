import { costSummary, type DbClient } from "@north/db";
import { COST_WINDOW_DAYS, costRow, DEFAULT_COST_TIMEZONE, type CostRowData } from "@/lib/cost-view";

/**
 * OBS-1: usage and cost per company for the settings page, from `agent_runs`
 * under RLS (owners read, the worker writes). Days are the owner's (ADR 0011).
 *
 * Repository used (packages/db, WP-A5): `costSummary(db, companyId, sinceDays, { timezone? })`
 * → `{ runs, inputTokens, outputTokens, costUsd, byRole[], byDay[] }`.
 */
export async function loadCostRows(
  db: DbClient,
  companies: readonly { readonly id: string; readonly name: string }[],
  timezone: string = DEFAULT_COST_TIMEZONE,
): Promise<readonly CostRowData[]> {
  const now = new Date();
  const rows = await Promise.all(companies.map(async (company) => costRow(company, await costSummary(db, company.id, COST_WINDOW_DAYS, { timezone }), now, timezone)));
  return Object.freeze(rows);
}
