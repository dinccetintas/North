import { campaignStatusClass, campaignStatusLabel, formatNumber, formatUsd } from "@/lib/labels";
import type { CampaignLike } from "@/lib/ledger-view";

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt className="mono-label text-faint">{label}</dt>
      <dd className="mt-0.5" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * GRW-K2 / BUD-3: every campaign the gate let through, with the provider's
 * cumulative figures and the status the collector and the kill switch set.
 * Only the worker writes these rows; the owner reads them.
 */
export function CampaignList({ campaigns }: { campaigns: readonly CampaignLike[] }) {
  if (campaigns.length === 0) return null;
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid="ledger-campaigns">
      {campaigns.map((c) => (
        <li key={c.id} className="bg-surface p-4" data-testid="campaign-row" data-campaign-id={c.id} data-provider-campaign-id={c.providerCampaignId} data-status={c.status}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="font-display text-xl leading-tight" data-testid="campaign-name">
              {c.name}
            </span>
            <span className={`mono-label ${campaignStatusClass(c.status)}`} data-testid="campaign-status">
              {campaignStatusLabel(c.status)}
              {c.sandbox ? " (sandbox)" : ""}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
            <Figure label="spent" value={formatUsd(c.spentTotalUsd)} testId="campaign-spent" />
            <Figure label="per day" value={formatUsd(c.dailyBudgetUsd)} testId="campaign-daily" />
            <Figure label="impressions" value={formatNumber(c.impressions)} testId="campaign-impressions" />
            <Figure label="clicks" value={formatNumber(c.clicks)} testId="campaign-clicks" />
            <Figure label="conversions" value={formatNumber(c.conversions)} testId="campaign-conversions" />
          </dl>
          <p className="mono-label mt-3 truncate text-faint">{c.providerCampaignId}</p>
        </li>
      ))}
    </ul>
  );
}
