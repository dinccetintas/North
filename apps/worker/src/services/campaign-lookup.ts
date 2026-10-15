import { getCampaign, getCampaignByProviderId, type CampaignRecord } from "@north/db";
import type { WorkerDeps } from "../deps";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The campaign ids a payload names: `campaignIds[]` or a single `campaignId`, as row ids (worker-made) or provider ids (agent-made). */
export const campaignIdsOf = (payload: Record<string, unknown>): readonly string[] =>
  Array.isArray(payload.campaignIds) ? payload.campaignIds.filter((id): id is string => typeof id === "string" && id.length > 0) : typeof payload.campaignId === "string" && payload.campaignId.length > 0 ? [payload.campaignId] : [];

/**
 * Resolves every campaign id of a payload through the company's own rows
 * (M4 review H1/M3): a row id or a provider id of another company, or an id
 * North never registered, is unknown and throws. Nothing reaches a provider
 * for a campaign the company's table does not know.
 */
export async function resolveCampaigns(deps: WorkerDeps, companyId: string, payload: Record<string, unknown>): Promise<readonly CampaignRecord[]> {
  const ids = campaignIdsOf(payload);
  if (ids.length === 0) throw new Error("no campaign id in the payload");
  const rows: CampaignRecord[] = [];
  for (const id of ids) {
    const row = UUID.test(id) ? await getCampaign(deps.db, companyId, id) : await getCampaignByProviderId(deps.db, companyId, id);
    if (!row) throw new Error(`campaign ${id} not found for this company`);
    rows.push(row);
  }
  return Object.freeze(rows);
}
