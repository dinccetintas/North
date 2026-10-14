import { CampaignSpecSchema, type AdsProvider, type CampaignSpec, type PauseAllResult, type SandboxSink, type StartCampaignResult } from "../types";
import { recordSandboxEvent, sandboxRef } from "./record";

export type SandboxCampaignStatus = "active" | "paused";

export interface SandboxCampaign {
  readonly campaignId: string;
  readonly companyId: string;
  readonly name: string;
  readonly dailyBudgetUsd: number;
  readonly status: SandboxCampaignStatus;
}

/**
 * In-memory ads provider. Campaigns live for the process lifetime; every call is
 * recorded through the sink so the audit trail shows what would have happened.
 */
export class SandboxAds implements AdsProvider {
  private campaigns: ReadonlyMap<string, SandboxCampaign> = new Map();

  constructor(private readonly sink?: SandboxSink) {}

  async startCampaign(raw: CampaignSpec): Promise<StartCampaignResult> {
    const spec = CampaignSpecSchema.parse(raw);
    const campaignId = sandboxRef("campaign");
    const campaign: SandboxCampaign = Object.freeze({ campaignId, companyId: spec.companyId, name: spec.name, dailyBudgetUsd: spec.dailyBudgetUsd, status: "active" });
    this.campaigns = new Map([...this.campaigns, [campaignId, campaign]]);
    await recordSandboxEvent(this.sink, {
      provider: "ads",
      op: "startCampaign",
      companyId: spec.companyId,
      ref: campaignId,
      payload: { name: spec.name, dailyBudgetUsd: spec.dailyBudgetUsd, audience: spec.audience, creativeChars: spec.creativeMarkdown.length },
    });
    return Object.freeze({ campaignId, sandbox: true });
  }

  async pauseCampaign(companyId: string, campaignId: string): Promise<void> {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign || campaign.companyId !== companyId) throw new Error(`Unknown campaign ${campaignId} for company ${companyId}`);
    this.setStatus(campaignId, "paused");
    await recordSandboxEvent(this.sink, { provider: "ads", op: "pauseCampaign", companyId, ref: campaignId, payload: { name: campaign.name } });
  }

  async pauseAll(companyId: string): Promise<PauseAllResult> {
    const paused = this.campaignsFor(companyId)
      .filter((c) => c.status === "active")
      .map((c) => c.campaignId);
    for (const id of paused) this.setStatus(id, "paused");
    await recordSandboxEvent(this.sink, { provider: "ads", op: "pauseAll", companyId, ref: sandboxRef("pause-all"), payload: { paused } });
    return Object.freeze({ paused: Object.freeze(paused) });
  }

  /** Snapshot of a company's campaigns, frozen so callers cannot reach the internal state. */
  campaignsFor(companyId: string): readonly SandboxCampaign[] {
    return Object.freeze([...this.campaigns.values()].filter((c) => c.companyId === companyId));
  }

  private setStatus(campaignId: string, status: SandboxCampaignStatus): void {
    const current = this.campaigns.get(campaignId);
    if (!current) return;
    this.campaigns = new Map([...this.campaigns, [campaignId, Object.freeze({ ...current, status })]]);
  }
}
