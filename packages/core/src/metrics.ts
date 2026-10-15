import { z } from "zod";

/**
 * OUT-1/OUT-2 metric samples. `company` rows are the company's own series
 * (goal bar, brief); `channel` rows are cumulative per campaign or batch and
 * carry provenance, so channel attribution never double-counts the goal.
 */
export const METRIC_SCOPES = ["company", "channel"] as const;
export type MetricScope = (typeof METRIC_SCOPES)[number];

/** Where a metric change came from; the ledger's `channel` column and the channel report use these. */
export const CHANNELS = ["meta_ads", "google_ads", "cold_email", "organic"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CAMPAIGN_STATUSES = ["active", "paused_cap", "paused_kill", "paused_user", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const provenanceBase = {
  /** End of the collection window; with the key it makes a retried step a no-op. */
  windowEnd: z.iso.datetime({ offset: true }),
  sandbox: z.boolean().default(false),
  /** The provider's raw figures for the window, kept for the audit; never read for decisions. */
  raw: z.record(z.string(), z.unknown()).optional(),
};

/**
 * Provenance of a channel sample: an ads campaign or an outreach batch. The
 * discriminator is the channel because the provenance key is channel-prefixed;
 * `organic` has no provenance (company-scope samples only).
 */
export const ProvenanceSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.enum(["meta_ads", "google_ads"]), campaignId: z.string().min(1).max(200), ...provenanceBase }),
  z.object({ channel: z.literal("cold_email"), batchId: z.string().min(1).max(64), messageIds: z.array(z.string().min(1)).max(500).default([]), ...provenanceBase }),
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** `meta_ads:<campaignId>` / `google_ads:<campaignId>` / `cold_email:<batchId>`: the stable key of one source. */
export function provenanceKey(p: Provenance): string {
  return p.channel === "cold_email" ? `cold_email:${p.batchId}` : `${p.channel}:${p.campaignId}`;
}

/** One delivery window of an ads campaign as the provider (or the sandbox simulation) reports it. */
export const AdDeliverySchema = z.object({
  spendUsd: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
});
export type AdDelivery = z.infer<typeof AdDeliverySchema>;
