import { capExceeded, windowDelta, type CapKind, type MetricCollectEvent } from "@north/core";
import { getBudget, latestChannelSample, listCampaigns, recordAttributionWindow, recordMetric, updateCampaignTotals, type CampaignRecord, type DbClient } from "@north/db";
import { isSandboxAds, NotConfiguredError, type CampaignInsights } from "@north/integrations";
import type { WorkerDeps } from "../deps";
import { completeAction, performPending } from "./actions";
import { openCapCard } from "./cap-card";
import { pauseForCap, resumeAfterDayRoll, resumeCampaign } from "./campaigns";
import { todayIsoDate } from "./dates";
import { ConnectionRequiredError, providerAuthFor } from "./provider-auth";
import { collectReplies, type RepliesResult } from "./replies";
import type { StepRunner } from "./steps";

export interface CollectResult {
  readonly campaigns: number;
  readonly entries: number;
  readonly paused: readonly string[];
  readonly resumed: readonly string[];
  readonly cardsOpened: readonly string[];
  readonly replies: RepliesResult;
  readonly analytics: boolean;
  readonly payments: boolean;
}

export interface AttributedWindow {
  readonly skipped: boolean;
  readonly duplicate: boolean;
  readonly capDaily: boolean;
  readonly capTotal: boolean;
  readonly campaign: CampaignRecord;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const isIso = (value: string): boolean => Number.isFinite(Date.parse(value));
const explain = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** Sandbox and cron only: the adapter writes the hour's simulated delivery for every active campaign. */
async function paceSandbox(deps: WorkerDeps, campaigns: readonly CampaignRecord[]): Promise<number> {
  const ads = deps.integrations.ads(null);
  if (!isSandboxAds(ads)) return 0;
  let paced = 0;
  for (const campaign of campaigns.filter((c) => c.status === "active")) {
    paced += (await ads.pace(campaign.providerCampaignId, 1)).length;
  }
  return paced;
}

/** The provider's lifetime figures for one campaign; a missing connection or an unconfigured adapter means "nothing this window", not a crash. */
export async function readInsights(deps: WorkerDeps, campaign: CampaignRecord): Promise<CampaignInsights | null> {
  try {
    const auth = await providerAuthFor(deps, campaign.companyId, "ads.start");
    return await deps.integrations.ads(auth).insights(campaign.companyId, campaign.providerCampaignId);
  } catch (cause) {
    if (!(cause instanceof ConnectionRequiredError) && !(cause instanceof NotConfiguredError)) console.error(`[collect] insights for ${campaign.providerCampaignId}: ${explain(cause)}`);
    return null;
  }
}

/** The outcome a campaign is attributed: sign-ups from conversions, site visitors from clicks, anything else from conversions. */
const attributedValue = (campaign: CampaignRecord, insights: CampaignInsights): number => (campaign.metricKey === "site_visitors" ? insights.clicks : insights.conversions);

/**
 * One attribution window for one campaign (OUT-1, BUD-1): cumulative channel
 * samples, the ledger delta and the spend applied, in one RPC. A window whose
 * figures did not move writes nothing; a replayed window is a duplicate.
 */
export async function attributeWindow(deps: WorkerDeps, campaign: CampaignRecord, insights: CampaignInsights, today: string = todayIsoDate(deps.clock()), now: Date = deps.clock()): Promise<AttributedWindow> {
  const key = `${campaign.channel}:${campaign.providerCampaignId}`;
  const [prevSpend, prevMetric] = await Promise.all([latestChannelSample(deps.db, campaign.companyId, "ad_spend_usd", key), latestChannelSample(deps.db, campaign.companyId, campaign.metricKey, key)]);
  const value = attributedValue(campaign, insights);
  const nothingYet = !prevSpend && insights.spendUsd === 0 && insights.impressions === 0 && insights.clicks === 0 && insights.conversions === 0;
  const unchanged = prevSpend?.value === insights.spendUsd && prevMetric?.value === value && campaign.impressions === insights.impressions && campaign.clicks === insights.clicks && campaign.conversions === insights.conversions;
  if (nothingYet || unchanged) return { skipped: true, duplicate: false, capDaily: false, capTotal: false, campaign };
  const delta = windowDelta(prevSpend ? { value: prevMetric?.value ?? 0, spendUsd: prevSpend.value } : null, { value, spendUsd: insights.spendUsd });
  const windowEnd = isIso(insights.asOf) ? new Date(insights.asOf).toISOString() : now.toISOString();
  const raw = {
    spendUsd: round2(Math.max(0, insights.spendUsd - campaign.spentTotalUsd)),
    impressions: Math.max(0, insights.impressions - campaign.impressions),
    clicks: Math.max(0, insights.clicks - campaign.clicks),
    conversions: Math.max(0, insights.conversions - campaign.conversions),
    asOf: insights.asOf,
  };
  const result = await recordAttributionWindow(deps.db, {
    companyId: campaign.companyId,
    taskId: campaign.taskId,
    campaignId: campaign.id,
    actionId: campaign.actionId,
    metricKey: campaign.metricKey,
    provenance: { channel: campaign.channel, campaignId: campaign.providerCampaignId, windowEnd, sandbox: insights.sandbox, raw },
    samples: [
      { metricKey: "ad_spend_usd", value: insights.spendUsd },
      { metricKey: "ad_impressions", value: insights.impressions },
      { metricKey: "ad_clicks", value: insights.clicks },
    ],
    before: delta.before,
    after: delta.after,
    costUsd: round2(delta.costUsd),
    category: "ads",
    day: today,
    note: `${campaign.name}: $${raw.spendUsd} spent, ${raw.clicks} clicks, ${raw.conversions} conversions in the window`,
  });
  const updated = await updateCampaignTotals(deps.db, campaign.id, { ...(await totalsFromSamples(deps.db, campaign, key, insights, today)), lastCollectedAt: now.toISOString() });
  return { skipped: false, duplicate: result.duplicate, capDaily: result.capDaily, capTotal: result.capTotal, campaign: updated };
}

/**
 * The campaign row's figures follow the latest channel samples, never the
 * step's local delta (M4 review L2): a step retried after a successful RPC
 * finds the samples already written and lands on the same numbers. Today's
 * spend grows by what the row has not reflected yet.
 */
async function totalsFromSamples(db: DbClient, campaign: CampaignRecord, key: string, insights: CampaignInsights, today: string) {
  const sample = async (metricKey: "ad_spend_usd" | "ad_impressions" | "ad_clicks", fallback: number): Promise<number> => (await latestChannelSample(db, campaign.companyId, metricKey, key))?.value ?? fallback;
  const spentTotalUsd = await sample("ad_spend_usd", insights.spendUsd);
  const spentBefore = campaign.lastCollectedAt?.slice(0, 10) === today ? campaign.spentTodayUsd : 0;
  return {
    spentTodayUsd: round2(spentBefore + Math.max(0, spentTotalUsd - campaign.spentTotalUsd)),
    spentTotalUsd,
    impressions: await sample("ad_impressions", insights.impressions),
    clicks: await sample("ad_clicks", insights.clicks),
    conversions: insights.conversions,
  };
}

/** A reached cap pauses an active campaign, and a row already `paused_cap` whose provider still delivers (a registration refused by the trigger). */
async function needsProviderPause(deps: WorkerDeps, campaign: CampaignRecord): Promise<boolean> {
  if (campaign.status === "active") return true;
  if (campaign.status !== "paused_cap") return false;
  try {
    const auth = await providerAuthFor(deps, campaign.companyId, "ads.pause");
    return (await deps.integrations.ads(auth).status(campaign.companyId, campaign.providerCampaignId)) === "active";
  } catch {
    return false;
  }
}

/** Company-scope samples from the analytics or payments provider; "no data" and an unconfigured adapter write nothing. */
async function companySamples(deps: WorkerDeps, companyId: string, source: "analytics" | "payments"): Promise<boolean> {
  try {
    if (source === "analytics") {
      const snapshot = await deps.integrations.analytics(null).read(companyId);
      if (!snapshot) return false;
      const label = snapshot.sandbox ? "sandbox_analytics" : "analytics";
      await recordMetric(deps.db, { companyId, metricKey: "signups", value: snapshot.signups, source: label });
      await recordMetric(deps.db, { companyId, metricKey: "site_visitors", value: snapshot.siteVisitors, source: label });
      return true;
    }
    const snapshot = await deps.integrations.payments(null).read(companyId);
    if (!snapshot) return false;
    const label = snapshot.sandbox ? "sandbox_payments" : "payments";
    await recordMetric(deps.db, { companyId, metricKey: "paying_customers", value: snapshot.payingCustomers, source: label });
    await recordMetric(deps.db, { companyId, metricKey: "mrr_usd", value: snapshot.mrrUsd, source: label });
    return true;
  } catch (cause) {
    if (!(cause instanceof NotConfiguredError)) console.error(`[collect] ${source} for ${companyId}: ${explain(cause)}`);
    return false;
  }
}

interface CapTally {
  readonly paused: string[];
  readonly cards: string[];
  /** Campaign ids asked in this run, so the end-of-run retry skips them. */
  readonly asked: Set<string>;
}

/** The cap card for one campaign (idempotent per campaign, day and cap level); an auto-ruled raise is performed and resumes the campaign. */
async function askCap(deps: WorkerDeps, step: StepRunner, id: string, campaign: CampaignRecord, cap: CapKind, today: string, out: CapTally): Promise<void> {
  out.asked.add(campaign.id);
  const card = await step.run(`${id}-card`, () => openCapCard(deps, campaign, cap, today));
  if (card.kind === "opened") out.cards.push(card.cardId);
  if (card.kind === "execute") {
    const outcome = await step.run(`${id}-perform`, () => performPending(deps, card.actionId));
    const done = await step.run(`${id}-record`, () => completeAction(deps, { actionId: card.actionId, tier: card.tier, outcome }));
    if (done.status === "executed") await resumeCampaign(deps, step, campaign, "cap_raised", `${id}-resume`);
  }
}

/** BUD-3 for one campaign whose window reached a cap: pause (through the gate) and ask (one card per campaign, day and cap level). */
async function handleCap(deps: WorkerDeps, step: StepRunner, i: number, window: AttributedWindow, today: string, out: CapTally): Promise<void> {
  const cap: CapKind = window.capTotal ? "total" : "daily";
  const campaign = window.campaign;
  if (await step.run(`cap-${i}-check`, () => needsProviderPause(deps, campaign))) {
    const run = await pauseForCap(deps, step, campaign, cap, today, `cap-${i}-pause`);
    if (run.completed?.status === "notified" || run.completed?.status === "executed") out.paused.push(campaign.id);
  }
  await askCap(deps, step, `cap-${i}`, campaign, cap, today, out);
}

/**
 * M4 review M2: a campaign still paused for a cap the budget still shows
 * asks again (a quota-deferred card, or a row the trigger registered
 * paused_cap). Idempotent: an open or answered card for the day is found.
 */
async function retryCapCards(deps: WorkerDeps, step: StepRunner, companyId: string, today: string, out: CapTally): Promise<void> {
  const paused = (await step.run("cap-retry-campaigns", () => listCampaigns(deps.db, companyId, { status: ["paused_cap"] }))).filter((c) => !out.asked.has(c.id));
  if (paused.length === 0) return;
  const budget = await step.run("cap-retry-budget", () => getBudget(deps.db, companyId, "ads"));
  const caps = budget ? capExceeded(budget) : { daily: false, total: false };
  if (!caps.daily && !caps.total) return;
  for (const [i, campaign] of paused.entries()) await askCap(deps, step, `cap-retry-${i}`, campaign, caps.total ? "total" : "daily", today, out);
}

/**
 * OUT-2: one company's hourly collection, every I/O its own durable step:
 * pace (sandbox + cron) → insights and attribution per campaign → cap pause
 * and card → day roll → cap cards still owed → outreach replies → analytics
 * and payments samples.
 */
export async function collectCompanyMetrics(deps: WorkerDeps, step: StepRunner, companyId: string, reason: MetricCollectEvent["reason"], now: () => Date = deps.clock): Promise<CollectResult> {
  const today = todayIsoDate(now());
  const campaigns = await step.run("campaigns", () => listCampaigns(deps.db, companyId, { status: ["active", "paused_cap"] }));
  if (reason === "cron" && deps.integrations.mode === "sandbox") await step.run("pace", () => paceSandbox(deps, campaigns));
  const out: CapTally = { paused: [], cards: [], asked: new Set() };
  let entries = 0;
  for (const [i, campaign] of campaigns.entries()) {
    const insights = await step.run(`insights-${i}`, () => readInsights(deps, campaign));
    if (!insights) continue;
    const window = await step.run(`attribute-${i}`, () => attributeWindow(deps, campaign, insights, today, now()));
    if (!window.skipped && !window.duplicate) entries += 1;
    if (window.capDaily || window.capTotal) await handleCap(deps, step, i, window, today, out);
  }
  const resumed = await resumeAfterDayRoll(deps, step, companyId, today);
  await retryCapCards(deps, step, companyId, today, out);
  const replies = await step.run("outreach-replies", () => collectReplies(deps, companyId, now()));
  const analytics = await step.run("analytics", () => companySamples(deps, companyId, "analytics"));
  const payments = await step.run("payments", () => companySamples(deps, companyId, "payments"));
  return Object.freeze({ campaigns: campaigns.length, entries, paused: Object.freeze(out.paused), resumed, cardsOpened: Object.freeze(out.cards), replies, analytics, payments });
}
