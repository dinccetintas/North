import { NotConfiguredError, ProviderError, redactSecret as redact } from "../errors";
import { CampaignSpecSchema, scopeValue, type AdsProvider, type CampaignInsights, type CampaignProviderStatus, type CampaignSpec, type ParsedCampaignSpec, type PauseManyResult, type StartCampaignResult } from "../growth-types";
import type { ProviderAuth } from "../types";
import type { FetchLike } from "./github";

// Graph API / Marketing API v26.0 (released 2026-07-29, the latest). The creative upload (image, video) lands in M11 (MKT-1).
export const META_GRAPH_API = "https://graph.facebook.com/v26.0";

const NOT_CONNECTED = "Meta Ads is not connected for this user (connect it in Settings → Connections)";

/** Insight action types that count as a conversion for a traffic campaign pointed at a sign-up page. */
export const CONVERSION_ACTION_TYPES: readonly string[] = Object.freeze(["lead", "complete_registration", "offsite_conversion.fb_pixel_lead", "offsite_conversion.fb_pixel_complete_registration", "onsite_conversion.lead_grouped"]);

const HEADLINE_MAX = 80;
const BODY_MAX = 500;

export interface MetaScopes {
  readonly adAccountId: string;
  readonly pageId: string | undefined;
}

/** The ad account (`act:<id>`, required) and page (`page:<id>`) from the connection's scopes. */
export function metaScopes(auth: ProviderAuth | null): MetaScopes {
  if (!auth) throw new NotConfiguredError(NOT_CONNECTED);
  const adAccountId = scopeValue(auth, "act");
  if (!adAccountId) throw new NotConfiguredError("Meta Ads connection has no ad account scope (act:<id>); reconnect it in Settings → Connections");
  return Object.freeze({ adAccountId, pageId: scopeValue(auth, "page") });
}

/** Headline = the first heading (or line), body = the remaining text, markdown markers stripped. */
export function creativeFromMarkdown(markdown: string): { readonly headline: string; readonly body: string } {
  const lines = markdown
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim())
    .filter((l) => l.length > 0);
  const [first, ...rest] = lines;
  return Object.freeze({ headline: (first ?? "Learn more").slice(0, HEADLINE_MAX), body: rest.join(" ").slice(0, BODY_MAX) });
}

/** Maps Meta's `effective_status` (or `status`) onto North's four states. */
export function mapMetaStatus(status: string | undefined): CampaignProviderStatus {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
      return "paused";
    case "ARCHIVED":
    case "DELETED":
    case "COMPLETED":
      return "ended";
    default:
      return "unknown";
  }
}

interface MetaInsightRow {
  readonly spend?: string;
  readonly impressions?: string;
  readonly clicks?: string;
  readonly actions?: readonly { readonly action_type: string; readonly value: string }[];
}

const num = (value: string | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Meta Marketing API through the user's own connection (BUD-2, ADR 0010):
 * one campaign → one ad set → one creative → one ad, then the campaign goes
 * ACTIVE. The token is only ever a bearer header (never a query parameter,
 * so it cannot land in a URL or an error); errors never echo it. North only
 * ever touches the campaign ids it created.
 */
export class MetaAds implements AdsProvider {
  constructor(
    private readonly auth: ProviderAuth | null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async api<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
    if (!this.auth) throw new NotConfiguredError(NOT_CONNECTED);
    const search = query ? `?${new URLSearchParams(query).toString()}` : "";
    let response: Response;
    try {
      response = await this.fetchImpl(`${META_GRAPH_API}${path}${search}`, {
        method,
        headers: { authorization: `Bearer ${this.auth.token}`, "content-type": "application/json", accept: "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ProviderError("meta_ads", redact(error instanceof Error ? error.message : "request failed", this.auth.token));
    }
    if (response.status < 200 || response.status >= 300) {
      const text = await response.text().catch(() => "");
      let message = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string; code?: number } };
        if (parsed.error?.message) message = `${parsed.error.message.slice(0, 200)}${parsed.error.code !== undefined ? ` (code ${parsed.error.code})` : ""}`;
      } catch {
        // not JSON: the truncated body is the message
      }
      throw new ProviderError("meta_ads", redact(`${method} ${path} → ${response.status} ${message}`, this.auth.token));
    }
    return (await response.json()) as T;
  }

  private async createAdSet(adAccountId: string, campaignId: string, spec: ParsedCampaignSpec): Promise<string> {
    const { id } = await this.api<{ id: string }>("POST", `/act_${adAccountId}/adsets`, {
      name: `${spec.name} — ad set`,
      campaign_id: campaignId,
      daily_budget: Math.round(spec.dailyBudgetUsd * 100),
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: { geo_locations: { countries: [...spec.targeting.countries] }, age_min: spec.targeting.ageMin, age_max: spec.targeting.ageMax },
      status: "ACTIVE",
    });
    return id;
  }

  private async createCreative(adAccountId: string, pageId: string, spec: ParsedCampaignSpec, landingUrl: string): Promise<string> {
    const creative = creativeFromMarkdown(spec.creativeMarkdown);
    const { id } = await this.api<{ id: string }>("POST", `/act_${adAccountId}/adcreatives`, {
      name: `${spec.name} — creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: { link: landingUrl, name: creative.headline, message: creative.body, call_to_action: { type: "LEARN_MORE", value: { link: landingUrl } } },
      },
    });
    return id;
  }

  async startCampaign(raw: CampaignSpec): Promise<StartCampaignResult> {
    const spec = CampaignSpecSchema.parse(raw);
    const { adAccountId, pageId: scopedPage } = metaScopes(this.auth);
    const landingUrl = spec.landingUrl;
    if (!landingUrl) throw new ProviderError("meta_ads", "a landing URL is required to start a live campaign (the company's live or preview site)");
    const pageId = spec.pageId ?? scopedPage;
    if (!pageId) throw new NotConfiguredError("Meta Ads connection has no page scope (page:<id>); a creative needs a page to post from");

    const campaign = await this.api<{ id: string }>("POST", `/act_${adAccountId}/campaigns`, { name: spec.name, objective: "OUTCOME_TRAFFIC", status: "PAUSED", special_ad_categories: [] });
    const adSetId = await this.createAdSet(adAccountId, campaign.id, spec);
    const creativeId = await this.createCreative(adAccountId, pageId, spec, landingUrl);
    await this.api<{ id: string }>("POST", `/act_${adAccountId}/ads`, { name: `${spec.name} — ad`, adset_id: adSetId, creative: { creative_id: creativeId }, status: "ACTIVE" });
    await this.api("POST", `/${encodeURIComponent(campaign.id)}`, { status: "ACTIVE" });
    return Object.freeze({ campaignId: campaign.id, sandbox: false });
  }

  async insights(_companyId: string, campaignId: string): Promise<CampaignInsights> {
    const result = await this.api<{ data?: readonly MetaInsightRow[] }>("GET", `/${encodeURIComponent(campaignId)}/insights`, undefined, { fields: "spend,impressions,clicks,actions", date_preset: "maximum" });
    const row = result.data?.[0] ?? {};
    const conversions = (row.actions ?? []).filter((a) => CONVERSION_ACTION_TYPES.includes(a.action_type)).reduce((sum, a) => sum + Math.round(num(a.value)), 0);
    return Object.freeze({ spendUsd: num(row.spend), impressions: Math.round(num(row.impressions)), clicks: Math.round(num(row.clicks)), conversions, asOf: this.clock().toISOString(), sandbox: false });
  }

  async pauseCampaign(_companyId: string, campaignId: string): Promise<void> {
    await this.api("POST", `/${encodeURIComponent(campaignId)}`, { status: "PAUSED" });
  }

  async resumeCampaign(_companyId: string, campaignId: string): Promise<void> {
    await this.api("POST", `/${encodeURIComponent(campaignId)}`, { status: "ACTIVE" });
  }

  /** BUD-4: pauses exactly the given ids, each on its own request; a failure is reported, never thrown, so the rest still stop. */
  async pauseMany(companyId: string, campaignIds: readonly string[]): Promise<PauseManyResult> {
    const outcomes = await Promise.all(
      campaignIds.map(async (campaignId) => {
        try {
          await this.pauseCampaign(companyId, campaignId);
          return { campaignId, error: null };
        } catch (error) {
          return { campaignId, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    return Object.freeze({
      paused: Object.freeze(outcomes.filter((o) => o.error === null).map((o) => o.campaignId)),
      failed: Object.freeze(outcomes.filter((o): o is { campaignId: string; error: string } => o.error !== null).map((o) => Object.freeze({ campaignId: o.campaignId, error: o.error }))),
    });
  }

  async status(_companyId: string, campaignId: string): Promise<CampaignProviderStatus> {
    const campaign = await this.api<{ status?: string; effective_status?: string }>("GET", `/${encodeURIComponent(campaignId)}`, undefined, { fields: "status,effective_status" });
    return mapMetaStatus(campaign.effective_status ?? campaign.status);
  }
}
