import { NotConfiguredError } from "../errors";
import type { AdsProvider, CampaignInsights, CampaignProviderStatus, CampaignSpec, PauseManyResult, StartCampaignResult } from "../growth-types";
import type { ProviderAuth } from "../types";

/** M4 scope decision: the Google Ads API needs a developer-token review that takes weeks, and the spec puts Meta first. */
export const GOOGLE_ADS_NOT_CONFIGURED = "Google Ads is not available yet: its API needs a developer-token review that takes weeks and the spec puts Meta first; use the Meta Ads connection";

/** Interface-complete stub so the collector and the kill switch can route `google_ads` campaigns once the adapter lands. */
export class GoogleAds implements AdsProvider {
  constructor(readonly auth: ProviderAuth | null = null) {}

  async startCampaign(_spec: CampaignSpec): Promise<StartCampaignResult> {
    throw new NotConfiguredError(GOOGLE_ADS_NOT_CONFIGURED);
  }

  async insights(_companyId: string, _campaignId: string): Promise<CampaignInsights> {
    throw new NotConfiguredError(GOOGLE_ADS_NOT_CONFIGURED);
  }

  async pauseCampaign(_companyId: string, _campaignId: string): Promise<void> {
    throw new NotConfiguredError(GOOGLE_ADS_NOT_CONFIGURED);
  }

  async resumeCampaign(_companyId: string, _campaignId: string): Promise<void> {
    throw new NotConfiguredError(GOOGLE_ADS_NOT_CONFIGURED);
  }

  async pauseMany(_companyId: string, _campaignIds: readonly string[]): Promise<PauseManyResult> {
    throw new NotConfiguredError(GOOGLE_ADS_NOT_CONFIGURED);
  }

  async status(_companyId: string, _campaignId: string): Promise<CampaignProviderStatus> {
    throw new NotConfiguredError(GOOGLE_ADS_NOT_CONFIGURED);
  }
}
