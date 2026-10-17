import { z } from "zod";
import type { ProviderAuth } from "./types";

/**
 * M4 growth and sales contracts (OUT-2, BUD-2, GRW-K2, SLS-K2): ads, outreach
 * mail, analytics and payments. Every provider here runs on the user's own
 * connection, so the `Integrations` entries are factories taking a
 * `ProviderAuth`; sandbox adapters ignore it.
 */

const COUNTRY = /^[A-Z]{2}$/;

/** Who the ads reach: ISO 3166-1 alpha-2 countries and an age band (Meta's minimum is 18). */
export const TargetingSchema = z
  .object({
    countries: z
      .array(z.string().trim().toUpperCase().regex(COUNTRY, "ISO 3166-1 alpha-2 country code"))
      .min(1)
      .max(25)
      .default(["US"]),
    ageMin: z.number().int().min(18).max(65).default(18),
    ageMax: z.number().int().min(18).max(65).default(65),
  })
  .refine((t) => t.ageMin <= t.ageMax, { message: "ageMin must not exceed ageMax", path: ["ageMax"] });
export type Targeting = z.infer<typeof TargetingSchema>;

const httpUrl = z
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//.test(value), { message: "landing URL must be http(s)" });

/**
 * What an agent asks the ads provider to run; the authority gate has already
 * approved it. `landingUrl` is the company's live or preview site (the worker
 * fills it in; the live Meta adapter refuses to start without one), `pageId`
 * overrides the connection's `page:<id>` scope.
 */
export const CampaignSpecSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  dailyBudgetUsd: z.number().nonnegative(),
  audience: z.string().max(2000).default(""),
  creativeMarkdown: z.string().max(20_000).default(""),
  targeting: TargetingSchema.default({ countries: ["US"], ageMin: 18, ageMax: 65 }),
  landingUrl: httpUrl.optional(),
  pageId: z.string().min(1).max(64).optional(),
});
export type CampaignSpec = z.input<typeof CampaignSpecSchema>;
export type ParsedCampaignSpec = z.output<typeof CampaignSpecSchema>;

export interface StartCampaignResult {
  /** Provider reference; sandbox refs start with `sandbox:campaign:`. */
  readonly campaignId: string;
  readonly sandbox: boolean;
}

/** Lifetime figures of one campaign as the provider reports them (cumulative; the collector diffs windows). */
export const CampaignInsightsSchema = z.object({
  spendUsd: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  asOf: z.string().min(1),
  sandbox: z.boolean(),
});
export type CampaignInsights = z.infer<typeof CampaignInsightsSchema>;

/** What the provider says about a campaign; `unknown` covers "not found" and "not ours". */
export const CAMPAIGN_PROVIDER_STATUSES = ["active", "paused", "ended", "unknown"] as const;
export type CampaignProviderStatus = (typeof CAMPAIGN_PROVIDER_STATUSES)[number];

/** Kill switch result: what was paused and what could not be (the worker records the failures). */
export interface PauseManyResult {
  readonly paused: readonly string[];
  readonly failed: readonly { readonly campaignId: string; readonly error: string }[];
}

export interface AdsProvider {
  startCampaign(spec: CampaignSpec): Promise<StartCampaignResult>;
  insights(companyId: string, campaignId: string): Promise<CampaignInsights>;
  pauseCampaign(companyId: string, campaignId: string): Promise<void>;
  resumeCampaign(companyId: string, campaignId: string): Promise<void>;
  /** BUD-4: pauses exactly the given campaigns; North never touches other campaigns in the account. */
  pauseMany(companyId: string, campaignIds: readonly string[]): Promise<PauseManyResult>;
  status(companyId: string, campaignId: string): Promise<CampaignProviderStatus>;
}

export const MESSAGE_STATUSES = ["sent", "unknown"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MAX_REPLY_LOOKUP = 500;

export const RepliesInputSchema = z.object({
  companyId: z.string().min(1),
  messageIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_REPLY_LOOKUP),
});
export type RepliesInput = z.input<typeof RepliesInputSchema>;

/**
 * Replies to one sent message: a count of human replies and when the last one
 * arrived (null when none); CMP-1: `bounced` when a bounce notice came back
 * for it (never counted as a reply), `optedOut` when a human reply asked to
 * stop (`OPT_OUT_PATTERN`). The reply text itself is never part of this.
 */
export interface ReplyCount {
  readonly messageId: string;
  readonly replies: number;
  readonly lastReplyAt: string | null;
  readonly bounced: boolean;
  readonly optedOut: boolean;
}

export interface SendOutreachResult {
  /** Provider reference; sandbox refs start with `sandbox:msg:`, Gmail refs are `gmail:<messageId>:<threadId>`. */
  readonly messageId: string;
  readonly sandbox: boolean;
}

/** The user's own mailbox for outreach (SLS-K2). The platform mail provider stays for notifications only. */
export interface OutreachMailProvider {
  send(input: OutreachSendInput): Promise<SendOutreachResult>;
  replies(input: RepliesInput): Promise<readonly ReplyCount[]>;
  status(messageId: string): Promise<MessageStatus>;
}

/** The sent message a reply answers (M4 review H2): the provider's message id and its thread, so a reply can never leave the lead's thread. */
export interface InReplyTo {
  readonly messageId: string;
  readonly threadId: string;
}

/**
 * CMP-1: the two `List-Unsubscribe` targets (RFC 2369, one-click per RFC
 * 8058). `mailto` is `<connected address>?subject=unsubscribe` without the
 * scheme; `url` is the worker's `/u/<token>` link.
 */
export interface ListUnsubscribe {
  readonly mailto: string;
  readonly url: string;
}

/** Same shape as the platform mail input; declared here so outreach does not depend on the mail section. */
export interface OutreachSendInput {
  readonly companyId: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly kind: "first_contact" | "reply";
  /** Required by the worker for `reply`: the thread the lead replied in. */
  readonly inReplyTo?: InReplyTo;
  /** Copies: plain single addresses only, never header text (the same `cc`/`bcc` keys core's `recipientsOf` checks at the gate). */
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  /** CMP-1: the compliance footer, appended after the signature marker (`FOOTER_MARKER`); the worker always passes it. */
  readonly footer?: string;
  /** CMP-1: the `List-Unsubscribe` targets; the worker always passes them. */
  readonly unsubscribe?: ListUnsubscribe;
}

export interface AnalyticsSnapshot {
  readonly signups: number;
  readonly siteVisitors: number;
  readonly sandbox: boolean;
}

/** Company-scope analytics (OUT-2); null means "no data", never zeros invented. */
export interface AnalyticsProvider {
  read(companyId: string): Promise<AnalyticsSnapshot | null>;
}

export interface PaymentsSnapshot {
  readonly payingCustomers: number;
  readonly mrrUsd: number;
  /** M6 (OUT-2): paid, unrefunded USD of the trailing 30 days (`revenue_usd`); absent when the provider does not read charges. */
  readonly revenueUsd?: number;
  readonly sandbox: boolean;
}

export interface PaymentsProvider {
  read(companyId: string): Promise<PaymentsSnapshot | null>;
}

/**
 * Reads `<prefix>:<value>` from the connection's scopes: `scopes` first (the
 * DB's `connections.scopes` list), then the single `scope` M3 adapters use.
 * Meta: `act:<ad account id>` and `page:<page id>`.
 */
export function scopeValue(auth: ProviderAuth | null, prefix: string): string | undefined {
  if (!auth) return undefined;
  const marker = `${prefix}:`;
  const candidates = [...(auth.scopes ?? []), ...(auth.scope ? [auth.scope] : [])];
  const hit = candidates.find((s) => s.startsWith(marker));
  return hit ? hit.slice(marker.length) || undefined : undefined;
}
