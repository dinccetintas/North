import {
  countLeads,
  ledgerEntriesForReport,
  listActionsByKind,
  listBudgets,
  listCampaigns,
  listLedgerEntries,
  listTasks,
  pendingActionsForCard,
  type ActionRecord,
  type DbClient,
} from "@north/db";
import { channelReport, type ChannelReportRow } from "@north/core/ledger/attribution";
import { effectiveDailyLimit, type BudgetState } from "@north/core/budget/guard";
import { budgetRows, ledgerRows, outreachRows, type BudgetRowData, type CampaignLike, type LedgerRowData, type OutreachRowData } from "@/lib/ledger-view";

/**
 * Every M4 read the web app makes against the WP-A4 repositories lives here,
 * under RLS (the owner's client; the worker alone writes these tables). Pages
 * get view models, never rows.
 *
 * Repositories used (packages/db, WP-A4): `listCampaigns(db, companyId, { status? })`,
 * `listLedgerEntries(db, companyId, { limit, sinceDays })` (with provenance),
 * `ledgerEntriesForReport(db, companyId, days)`, `listBudgets`,
 * `listActionsByKind(db, companyId, kind, sinceDays)`, `countLeads(db, companyId)`,
 * `pendingActionsForCard(db, cardId)`.
 *
 * TODO(WP-A4): until `packages/db` exports `listCampaigns` (campaigns.ts),
 * `listActionsByKind` and `pendingActionsForCard` (actions.ts) and `countLeads`
 * (leads.ts), this is the one file the web typecheck fails on. The campaign
 * record must carry `id, providerCampaignId, name, status, dailyBudgetUsd,
 * spentTodayUsd, spentTotalUsd, impressions, clicks, conversions, sandbox`
 * (see `CampaignLike`).
 */

export const LEDGER_WINDOW_DAYS = 30;
export const LEDGER_ENTRY_LIMIT = 200;

export interface LedgerPageData {
  readonly budgets: readonly BudgetRowData[];
  readonly campaigns: readonly CampaignLike[];
  readonly entries: readonly LedgerRowData[];
  readonly report: readonly ChannelReportRow[];
  readonly outreach: readonly OutreachRowData[];
  /** True while a campaign is active: the page keeps refreshing so the hourly collection shows up. */
  readonly live: boolean;
}

/** Only the fields the page shows travel to the components (the db `CampaignRecord` satisfies this structurally). */
const toCampaignRow = (c: CampaignLike): CampaignLike =>
  Object.freeze({
    id: c.id,
    providerCampaignId: c.providerCampaignId,
    name: c.name,
    status: c.status,
    dailyBudgetUsd: c.dailyBudgetUsd,
    spentTodayUsd: c.spentTodayUsd,
    spentTotalUsd: c.spentTotalUsd,
    impressions: c.impressions,
    clicks: c.clicks,
    conversions: c.conversions,
    sandbox: c.sandbox,
  });

export async function loadLedgerPage(db: DbClient, companyId: string): Promise<LedgerPageData> {
  const [budgets, campaignRecords, entries, reportEntries, sends, tasks] = await Promise.all([
    listBudgets(db, companyId),
    listCampaigns(db, companyId, {}),
    listLedgerEntries(db, companyId, { limit: LEDGER_ENTRY_LIMIT, sinceDays: LEDGER_WINDOW_DAYS }),
    ledgerEntriesForReport(db, companyId, LEDGER_WINDOW_DAYS),
    listActionsByKind(db, companyId, "email.send.first_contact", LEDGER_WINDOW_DAYS),
    listTasks(db, companyId, {}),
  ]);
  const campaigns: readonly CampaignLike[] = campaignRecords.map(toCampaignRow);
  return Object.freeze({
    budgets: budgetRows(budgets),
    campaigns,
    entries: ledgerRows(entries, campaigns, tasks),
    report: channelReport(reportEntries),
    outreach: outreachRows(sends, entries, tasks),
    live: campaigns.some((c) => c.status === "active"),
  });
}

/** Leads known for the company (upload + research), for the Team page. */
export function leadsCount(db: DbClient, companyId: string): Promise<number> {
  return countLeads(db, companyId);
}

/** The pending actions a card decides on: one per email of a batch, one for anything else. */
export function pendingCardActions(db: DbClient, cardId: string): Promise<readonly ActionRecord[]> {
  return pendingActionsForCard(db, cardId);
}

export interface DecisionCampaignData {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly spentTodayUsd: number;
  readonly dailyCapUsd: number;
  readonly spentTotalUsd: number;
  readonly totalCapUsd: number;
}

/** The campaign a cap card is about (BUD-3), by id or, when the action row no longer carries it, by name; null when unknown. */
export async function capCardCampaign(db: DbClient, companyId: string, ref: { readonly campaignId: string | null; readonly campaignName: string | null }): Promise<DecisionCampaignData | null> {
  if (!ref.campaignId && !ref.campaignName) return null;
  const [campaignRecords, budgets] = await Promise.all([listCampaigns(db, companyId, {}), listBudgets(db, companyId)]);
  const campaigns: readonly CampaignLike[] = campaignRecords.map(toCampaignRow);
  const campaign = campaigns.find((c) => c.id === ref.campaignId) ?? campaigns.find((c) => c.name === ref.campaignName) ?? null;
  if (!campaign) return null;
  const budget = budgets.find((b: BudgetState) => b.category === "ads") ?? null;
  return Object.freeze({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    spentTodayUsd: budget?.spentTodayUsd ?? campaign.spentTodayUsd,
    dailyCapUsd: budget ? effectiveDailyLimit(budget) : campaign.dailyBudgetUsd,
    spentTotalUsd: budget?.spentTotalUsd ?? campaign.spentTotalUsd,
    totalCapUsd: budget?.totalLimitUsd ?? 0,
  });
}
