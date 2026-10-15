import { ActionSpecSchema, type ActionSpec } from "../authority/action";
import { effectiveDailyLimit, type BudgetState } from "../budget/guard";

export const CAP_KINDS = ["daily", "total"] as const;
export type CapKind = (typeof CAP_KINDS)[number];

/** The campaign facts a cap card needs; the worker reads them from the `campaigns` row. */
export interface CapCardCampaign {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly dailyBudgetUsd: number;
  readonly totalBudgetUsd: number;
  readonly spentTotalUsd: number;
}

export interface CapCardInput {
  readonly campaign: CapCardCampaign;
  readonly budget: BudgetState;
  readonly cap: CapKind;
  /** The day the cap was hit, `YYYY-MM-DD`; one cap card per campaign per day. */
  readonly day: string;
}

const usd = (value: number): string => `$${value}`;

/**
 * BUD-3: the one K2 card opened after a campaign was paused for a cap. Pure:
 * returns the `budget.cap.raise` action the worker gates. The raise is the
 * campaign's daily budget for a daily cap (today only) and the campaign's
 * remaining total for a total cap; over $500 the gate makes it K3. The card's
 * default and recommendation are `decline` (see `cardFor`): the campaign stays
 * paused unless the CEO says otherwise.
 */
export function capCardSpec(input: CapCardInput): ActionSpec {
  const { campaign, budget, cap, day } = input;
  const daily = cap === "daily";
  const capUsd = daily ? effectiveDailyLimit(budget) : budget.totalLimitUsd;
  const spentUsd = daily ? budget.spentTodayUsd : budget.spentTotalUsd;
  const raiseUsd = daily ? campaign.dailyBudgetUsd : Math.max(0, campaign.totalBudgetUsd - campaign.spentTotalUsd);
  const scope = daily ? `Today's ${budget.category} cap` : `The ${budget.category} total cap`;
  const ask = daily ? "today's cap" : "the total cap";
  return ActionSpecSchema.parse({
    kind: "budget.cap.raise",
    companyId: campaign.companyId,
    agentRole: "growth",
    description: `${scope} (${usd(capUsd)}) is spent on ${campaign.name} (${usd(spentUsd)} so far). Raise ${ask} by ${usd(raiseUsd)} and resume?`,
    amountUsd: raiseUsd,
    category: budget.category,
    payload: {
      campaignId: campaign.id,
      campaignName: campaign.name,
      resumeCampaignId: campaign.id,
      cap,
      day,
      spentUsd,
      capUsd,
    },
  });
}
