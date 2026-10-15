import { NotConfiguredError } from "../errors";
import type { AnalyticsProvider, AnalyticsSnapshot } from "../growth-types";
import type { ProviderAuth } from "../types";

/** M4 scope decision: the landing page North ships carries no tracker (M3 build rule), so there is no PostHog data to read until the founder adds one. */
export const POSTHOG_NOT_CONFIGURED = "PostHog analytics is not available yet: the landing page North ships carries no tracker, so there is no data to read until the founder adds one";

/** Interface-complete stub; the collector treats the error as "no company-scope analytics this window". */
export class PostHogAnalytics implements AnalyticsProvider {
  constructor(readonly auth: ProviderAuth | null = null) {}

  async read(_companyId: string): Promise<AnalyticsSnapshot | null> {
    throw new NotConfiguredError(POSTHOG_NOT_CONFIGURED);
  }
}
