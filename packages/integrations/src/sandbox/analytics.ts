import type { AnalyticsProvider, AnalyticsSnapshot } from "../growth-types";
import type { SandboxSink } from "../types";
import { AdsStore, sumDeliveries } from "./ads-store";
import { defaultSandboxRoot } from "./files";
import { recordSandboxEvent, sandboxRef } from "./record";

/**
 * Company-scope analytics in sandbox (OUT-2): the landing page ships no
 * tracker, so the only "site" data is what the sandbox campaigns delivered.
 * `signups` = Σ conversions and `siteVisitors` = Σ clicks over the company's
 * campaign logs; null when the company has no campaign at all (no data is
 * not zero).
 */
export class SandboxAnalytics implements AnalyticsProvider {
  private readonly store: AdsStore;

  constructor(
    private readonly sink?: SandboxSink,
    root: string = defaultSandboxRoot(),
  ) {
    this.store = new AdsStore(root);
  }

  async read(companyId: string): Promise<AnalyticsSnapshot | null> {
    const campaigns = (await this.store.list()).filter((c) => c.companyId === companyId);
    if (campaigns.length === 0) return null;
    const logs = await Promise.all(campaigns.map((c) => this.store.deliveries(c.campaignId)));
    const total = sumDeliveries(logs.flat());
    const snapshot: AnalyticsSnapshot = Object.freeze({ signups: total.conversions, siteVisitors: total.clicks, sandbox: true });
    await recordSandboxEvent(this.sink, { provider: "analytics", op: "read", companyId, ref: sandboxRef("analytics"), payload: { ...snapshot, campaigns: campaigns.length } });
    return snapshot;
  }
}
