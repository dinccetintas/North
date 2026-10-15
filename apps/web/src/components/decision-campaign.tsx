import Link from "next/link";
import { campaignStatusClass, campaignStatusLabel, formatUsd } from "@/lib/labels";
import type { DecisionCampaignData } from "@/lib/ledger-data";

/**
 * BUD-3: the campaign a cap card is about. The figures are the ads budget's
 * (what was spent today against today's cap, in total against the total cap)
 * so the CEO sees the same numbers the collector acted on.
 */
export function DecisionCampaign({ slug, campaign }: { slug: string; campaign: DecisionCampaignData }) {
  const cells: readonly (readonly [string, string])[] = [
    ["Spent today", formatUsd(campaign.spentTodayUsd)],
    ["Today's cap", formatUsd(campaign.dailyCapUsd)],
    ["Spent total", formatUsd(campaign.spentTotalUsd)],
    ["Total cap", formatUsd(campaign.totalCapUsd)],
  ];
  return (
    <section className="mt-10">
      <h2 className="mono-label text-faint">Campaign</h2>
      <div className="mt-3 border border-surface-border bg-surface p-5" data-testid="decision-campaign" data-campaign-id={campaign.id} data-status={campaign.status}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-display text-xl leading-tight" data-testid="decision-campaign-name">
            {campaign.name}
          </span>
          <span className={`mono-label ${campaignStatusClass(campaign.status)}`} data-testid="decision-campaign-status">
            {campaignStatusLabel(campaign.status)}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {cells.map(([label, value]) => (
            <div key={label}>
              <dt className="mono-label text-faint">{label}</dt>
              <dd className="mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-muted">
          Decline keeps the campaign paused; approve raises today&apos;s cap by the amount on the card and resumes it.{" "}
          <Link href={`/c/${slug}/ledger`} className="hover:underline">
            Open the ledger →
          </Link>
        </p>
      </div>
    </section>
  );
}
