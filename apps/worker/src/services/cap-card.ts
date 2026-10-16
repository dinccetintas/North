import { capCardSpec, type ActionSpec, type CapKind, type Tier } from "@north/core";
import { getBudget, listActionsByKind, recordActionTransition, type ActionRecord, type CampaignRecord, type DbClient } from "@north/db";
import type { WorkerDeps } from "../deps";
import { specsByHead } from "./action-specs";
import { gateAction, gateStandalone } from "./actions";
import { ownerDay } from "./dates";

export type CapCardOutcome =
  | { readonly kind: "opened"; readonly cardId: string; readonly actionId: string }
  | { readonly kind: "exists"; readonly actionId: string }
  | { readonly kind: "execute"; readonly actionId: string; readonly tier: Tier }
  | { readonly kind: "deferred" | "blocked" | "none"; readonly reason: string };

const CAP_KIND = "budget.cap.raise";
const LOOKBACK_DAYS = 2;

interface CapKey {
  readonly campaignId: string;
  readonly day: string;
  readonly cap: CapKind;
  readonly capUsd: number;
}

const keyOf = (payload: Record<string, unknown> | undefined): CapKey | null =>
  payload && typeof payload.campaignId === "string" && typeof payload.day === "string" && (payload.cap === "daily" || payload.cap === "total") && typeof payload.capUsd === "number"
    ? { campaignId: payload.campaignId, day: payload.day, cap: payload.cap, capUsd: payload.capUsd }
    : null;

const sameKey = (a: CapKey, b: CapKey | null): boolean => b !== null && a.campaignId === b.campaignId && a.day === b.day && a.cap === b.cap && a.capUsd === b.capUsd;

/**
 * Cap-card rows already recorded for this campaign, day and cap level (chain
 * heads, their spec read back through the chain so an answered card counts),
 * split into asked (pending or answered) and quota-deferred.
 */
async function priorCards(db: DbClient, rows: readonly ActionRecord[], key: CapKey): Promise<{ readonly asked: ActionRecord | undefined; readonly deferred: readonly ActionRecord[] }> {
  const specs = await specsByHead(db, rows);
  const matching = rows.filter((a) => sameKey(key, keyOf(specs.get(a.id)?.payload)));
  const deferred = matching.filter((a) => a.status === "blocked" && a.payload.quota_deferred === true);
  const asked = matching.find((a) => !deferred.includes(a) && a.status !== "blocked");
  return { asked, deferred };
}

/**
 * BUD-3, second half: one K2 `budget.cap.raise` card per campaign, day and
 * cap level, through the gate with the campaign's task as the worker's own
 * request. An open or answered card for the same key means none; a
 * quota-deferred one is retried by the next collection (the campaign is
 * already paused, so waiting costs nothing). Approving raises the cap for
 * the day and resumes the campaign (settle's follow-up). The day is the
 * owner-local day (M6), the same day the card's quota counts on.
 */
export async function openCapCard(deps: WorkerDeps, campaign: CampaignRecord, cap: CapKind, today?: string): Promise<CapCardOutcome> {
  const day = today ?? (await ownerDay(deps, campaign.companyId));
  const budget = await getBudget(deps.db, campaign.companyId, "ads", day);
  if (!budget) return { kind: "none", reason: "no ads budget" };
  const spec: ActionSpec = capCardSpec({ campaign, budget, cap, day });
  const key = keyOf(spec.payload);
  if (!key) return { kind: "none", reason: "cap card spec has no key" };
  const prior = await priorCards(deps.db, await listActionsByKind(deps.db, campaign.companyId, CAP_KIND, LOOKBACK_DAYS), key);
  if (prior.asked) return { kind: "exists", actionId: prior.asked.id };
  const gated = campaign.taskId ? await gateAction(deps, campaign.taskId, spec, { origin: "worker" }) : await gateStandalone(deps, spec);
  // The new attempt is the live one: earlier deferred rows are retired whatever the outcome (the collector retries, M4 review M2).
  for (const row of prior.deferred) await recordActionTransition(deps.db, { actionId: row.id, status: "blocked", note: "retried" });
  switch (gated.kind) {
    case "card":
      return { kind: "opened", cardId: gated.cardId, actionId: gated.actionId };
    case "execute":
      return { kind: "execute", actionId: gated.actionId, tier: gated.tier };
    case "deferred":
      return { kind: "deferred", reason: "today's decisions are spent; the next collection asks again" };
    case "blocked":
      return { kind: "blocked", reason: gated.reason };
    default:
      return { kind: "none", reason: `unexpected gate result ${gated.kind}` };
  }
}
