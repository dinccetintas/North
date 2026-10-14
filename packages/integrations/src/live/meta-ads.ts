import { NotConfiguredError } from "../errors";
import type { AdsProvider, CampaignSpec, PauseAllResult, StartCampaignResult } from "../types";

export interface MetaAdsConfig {
  readonly accessToken: string;
  readonly adAccountId: string;
}

/** Reads the Meta Ads keys; null unless both are present. */
export function metaAdsConfig(env: NodeJS.ProcessEnv): MetaAdsConfig | null {
  const accessToken = env.META_ACCESS_TOKEN;
  const adAccountId = env.META_AD_ACCOUNT_ID;
  return accessToken && adAccountId ? { accessToken, adAccountId } : null;
}

const NOT_YET = "Meta Ads live adapter lands in M4; use INTEGRATIONS_MODE=sandbox until then";

/** Placeholder for the M4 live adapter: selected only when keys exist, and refuses every call until implemented. */
export class MetaAds implements AdsProvider {
  constructor(readonly config?: MetaAdsConfig) {}

  async startCampaign(_spec: CampaignSpec): Promise<StartCampaignResult> {
    throw new NotConfiguredError(NOT_YET);
  }

  async pauseCampaign(_companyId: string, _campaignId: string): Promise<void> {
    throw new NotConfiguredError(NOT_YET);
  }

  async pauseAll(_companyId: string): Promise<PauseAllResult> {
    throw new NotConfiguredError(NOT_YET);
  }
}
