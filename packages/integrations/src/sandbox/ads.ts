import type { AdDelivery } from "@north/core";
import { ProviderError } from "../errors";
import { CampaignSpecSchema, type AdsProvider, type CampaignInsights, type CampaignProviderStatus, type CampaignSpec, type PauseManyResult, type StartCampaignResult } from "../growth-types";
import type { SandboxSink } from "../types";
import { AdsStore, sumDeliveries, type SandboxCampaign, type SandboxCampaignStatus } from "./ads-store";
import { defaultSandboxRoot } from "./files";
import { recordSandboxEvent, sandboxRef } from "./record";

export type { SandboxCampaign, SandboxCampaignStatus } from "./ads-store";

/** Sandbox economics: $0.40 per click, 1.2% click-through, 5% of clicks convert. */
export const SANDBOX_COST_PER_CLICK_USD = 0.4;
export const SANDBOX_CLICK_THROUGH = 0.012;
export const SANDBOX_CONVERSION_RATE = 0.05;

/** FNV-1a over a string, so the same campaign id and hour always jitter the same way. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * The default delivery of one paced hour: spend = dailyBudget / 24 exactly
 * (24 paced hours spend one daily budget), clicks ≈ spend / $0.40 with a
 * ±15% jitter derived from the campaign id and hour index (so two campaigns
 * never look identical and a replay is reproducible), impressions from the
 * click-through, conversions ≈ 5% of clicks accrued across hours so a
 * $10/day campaign still converts about once a day.
 */
export function hourlyDelivery(campaignId: string, dailyBudgetUsd: number, hourIndex: number): AdDelivery {
  const jitter = 0.85 + (hash32(`${campaignId}:${hourIndex}`) % 3001) / 10_000;
  const spendUsd = round4(dailyBudgetUsd / 24);
  const clicks = Math.round((spendUsd / SANDBOX_COST_PER_CLICK_USD) * jitter);
  const impressions = Math.round(clicks / SANDBOX_CLICK_THROUGH);
  const expectedClicksPerHour = dailyBudgetUsd / 24 / SANDBOX_COST_PER_CLICK_USD;
  const accrued = (h: number): number => Math.floor(h * expectedClicksPerHour * SANDBOX_CONVERSION_RATE);
  const conversions = accrued(hourIndex + 1) - accrued(hourIndex);
  return Object.freeze({ spendUsd, impressions, clicks, conversions });
}

/**
 * File-backed ads provider (BUD-4, OUT-2): campaigns live under
 * `<root>/ads/<campaignId>.json` with a `.deliveries.jsonl` log, so a new
 * instance over the same root sees them. Every operation is recorded through
 * the sink. `deliver` and `pace` are simulation-only entry points for the
 * worker's sandbox routes and cron; they do not exist on the live adapter.
 */
export class SandboxAds implements AdsProvider {
  private readonly store: AdsStore;

  constructor(
    private readonly sink?: SandboxSink,
    root: string = defaultSandboxRoot(),
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.store = new AdsStore(root);
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private async owned(companyId: string, campaignId: string): Promise<SandboxCampaign> {
    const campaign = await this.store.read(campaignId);
    if (!campaign || campaign.companyId !== companyId) throw new ProviderError("sandbox-ads", `unknown campaign ${campaignId} for company ${companyId}`);
    return campaign;
  }

  private async setStatus(campaign: SandboxCampaign, status: SandboxCampaignStatus): Promise<SandboxCampaign> {
    const next = Object.freeze({ ...campaign, status, updatedAt: this.now() });
    await this.store.write(next);
    return next;
  }

  async startCampaign(raw: CampaignSpec): Promise<StartCampaignResult> {
    const spec = CampaignSpecSchema.parse(raw);
    const campaignId = sandboxRef("campaign");
    const at = this.now();
    const campaign: SandboxCampaign = Object.freeze({
      campaignId,
      companyId: spec.companyId,
      name: spec.name,
      dailyBudgetUsd: spec.dailyBudgetUsd,
      audience: spec.audience,
      targeting: spec.targeting,
      ...(spec.landingUrl ? { landingUrl: spec.landingUrl } : {}),
      status: "active",
      createdAt: at,
      updatedAt: at,
    });
    await this.store.write(campaign);
    await recordSandboxEvent(this.sink, {
      provider: "ads",
      op: "startCampaign",
      companyId: spec.companyId,
      ref: campaignId,
      payload: { name: spec.name, dailyBudgetUsd: spec.dailyBudgetUsd, audience: spec.audience, targeting: spec.targeting, landingUrl: spec.landingUrl ?? null, creativeChars: spec.creativeMarkdown.length },
    });
    return Object.freeze({ campaignId, sandbox: true });
  }

  async insights(companyId: string, campaignId: string): Promise<CampaignInsights> {
    await this.owned(companyId, campaignId);
    const lines = await this.store.deliveries(campaignId);
    const total = sumDeliveries(lines);
    return Object.freeze({ ...total, spendUsd: round2(total.spendUsd), asOf: lines.at(-1)?.at ?? this.now(), sandbox: true });
  }

  async pauseCampaign(companyId: string, campaignId: string): Promise<void> {
    const campaign = await this.setStatus(await this.owned(companyId, campaignId), "paused");
    await recordSandboxEvent(this.sink, { provider: "ads", op: "pauseCampaign", companyId, ref: campaignId, payload: { name: campaign.name } });
  }

  async resumeCampaign(companyId: string, campaignId: string): Promise<void> {
    const campaign = await this.setStatus(await this.owned(companyId, campaignId), "active");
    await recordSandboxEvent(this.sink, { provider: "ads", op: "resumeCampaign", companyId, ref: campaignId, payload: { name: campaign.name } });
  }

  /** Pauses exactly the given ids that belong to the company; the rest are reported, never touched. */
  async pauseMany(companyId: string, campaignIds: readonly string[]): Promise<PauseManyResult> {
    const paused: string[] = [];
    const failed: { campaignId: string; error: string }[] = [];
    for (const campaignId of campaignIds) {
      const campaign = await this.store.read(campaignId);
      if (!campaign || campaign.companyId !== companyId) {
        failed.push({ campaignId, error: `unknown campaign ${campaignId} for company ${companyId}` });
        continue;
      }
      if (campaign.status !== "paused") await this.setStatus(campaign, "paused");
      paused.push(campaignId);
    }
    if (campaignIds.length > 0) await recordSandboxEvent(this.sink, { provider: "ads", op: "pauseMany", companyId, ref: sandboxRef("pause-many"), payload: { paused: [...paused], failed: failed.map((f) => f.campaignId) } });
    return Object.freeze({ paused: Object.freeze(paused), failed: Object.freeze(failed.map((f) => Object.freeze(f))) });
  }

  async status(companyId: string, campaignId: string): Promise<CampaignProviderStatus> {
    const campaign = await this.store.read(campaignId);
    if (!campaign || campaign.companyId !== companyId) return "unknown";
    return campaign.status;
  }

  /** Simulation route: the provider "reported" this delivery (allowed in any status; the cap logic is the worker's). */
  async deliver(campaignId: string, delivery: AdDelivery): Promise<AdDelivery> {
    const campaign = await this.store.read(campaignId);
    if (!campaign) throw new ProviderError("sandbox-ads", `unknown campaign ${campaignId}`);
    const line = await this.store.appendDelivery(campaignId, delivery, "manual", this.now());
    await recordSandboxEvent(this.sink, { provider: "ads", op: "deliver", companyId: campaign.companyId, ref: campaignId, payload: { spendUsd: line.spendUsd, impressions: line.impressions, clicks: line.clicks, conversions: line.conversions } });
    return Object.freeze({ spendUsd: line.spendUsd, impressions: line.impressions, clicks: line.clicks, conversions: line.conversions });
  }

  /** Cron simulation: appends `hours` default deliveries for an active campaign; paused, ended or unknown campaigns get none. */
  async pace(campaignId: string, hours: number): Promise<readonly AdDelivery[]> {
    const campaign = await this.store.read(campaignId);
    if (!campaign || campaign.status !== "active" || !Number.isInteger(hours) || hours <= 0) return Object.freeze([]);
    const existing = (await this.store.deliveries(campaignId)).filter((d) => d.source === "pace").length;
    const added: AdDelivery[] = [];
    for (let i = 0; i < hours; i += 1) {
      const delivery = hourlyDelivery(campaignId, campaign.dailyBudgetUsd, existing + i);
      await this.store.appendDelivery(campaignId, delivery, "pace", this.now());
      added.push(delivery);
    }
    const total = sumDeliveries(added);
    await recordSandboxEvent(this.sink, { provider: "ads", op: "pace", companyId: campaign.companyId, ref: campaignId, payload: { hours, ...total } });
    return Object.freeze(added);
  }

  /** Snapshot of a company's campaigns, frozen so callers cannot reach the internal state. */
  async campaignsFor(companyId: string): Promise<readonly SandboxCampaign[]> {
    return Object.freeze((await this.store.list()).filter((c) => c.companyId === companyId));
  }
}
