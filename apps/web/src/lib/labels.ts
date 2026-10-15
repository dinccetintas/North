import type { BudgetCategory } from "@north/core/authority/action";
import { SIGNAL_STATUS_WORDS } from "@north/core/brief/compose";
import type { ArtifactKind, MetricKey, TaskType } from "@north/core/tasks/types";
import type { TaskStatus } from "@north/core/tasks/lifecycle";
import type { CampaignStatus, Channel } from "@north/core/metrics";
import type { SignalSource, SignalStatus } from "@north/core/signals/types";

/** Human labels for everything the UI shows as a key. Extend here, never inline strings in pages. */

export const METRIC_LABELS: Readonly<Record<MetricKey, string>> = Object.freeze({
  paying_customers: "Paying customers",
  signups: "Sign-ups",
  waitlist: "Waitlist entries",
  demo_calls: "Demo calls booked",
  mrr_usd: "Monthly recurring revenue (USD)",
  revenue_usd: "Revenue (USD)",
  site_visitors: "Site visitors",
  email_replies: "Email replies",
  artifacts: "Artifacts produced",
  ad_spend_usd: "Ad spend (USD)",
  ad_impressions: "Ad impressions",
  ad_clicks: "Ad clicks",
  emails_sent: "Emails sent",
});

export function metricLabel(key: string): string {
  return key in METRIC_LABELS ? METRIC_LABELS[key as MetricKey] : key.replace(/_/g, " ");
}

/** OUT-1 channels as the ledger names them. */
export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = Object.freeze({
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  cold_email: "Cold email",
  organic: "Organic",
});

export function channelLabel(channel: string): string {
  return channel in CHANNEL_LABELS ? CHANNEL_LABELS[channel as Channel] : channel.replace(/_/g, " ");
}

/** One phrase per campaign status (BUD-3/BUD-4); the raw status stays in `data-status`. */
export const CAMPAIGN_STATUS_LABELS: Readonly<Record<CampaignStatus, string>> = Object.freeze({
  active: "active",
  paused_cap: "paused · cap reached",
  paused_kill: "paused · kill switch",
  paused_user: "paused by you",
  ended: "ended",
});

export const CAMPAIGN_STATUS_CLASS: Readonly<Record<CampaignStatus, string>> = Object.freeze({
  active: "text-success",
  paused_cap: "text-warning",
  paused_kill: "text-error",
  paused_user: "text-faint",
  ended: "text-faint",
});

export function campaignStatusLabel(status: string): string {
  return status in CAMPAIGN_STATUS_LABELS ? CAMPAIGN_STATUS_LABELS[status as CampaignStatus] : status.replace(/_/g, " ");
}

export function campaignStatusClass(status: string): string {
  return status in CAMPAIGN_STATUS_CLASS ? CAMPAIGN_STATUS_CLASS[status as CampaignStatus] : "text-faint";
}

export const BUDGET_LABELS: Readonly<Record<BudgetCategory, string>> = Object.freeze({
  ads: "Ads",
  tools: "Tools and subscriptions",
  domain: "Domains",
  other: "Everything else",
});

/** Default caps in USD shown on the budget step. */
export const BUDGET_DEFAULTS: Readonly<Record<BudgetCategory, { readonly total: number; readonly daily: number }>> =
  Object.freeze({
    ads: { total: 300, daily: 20 },
    tools: { total: 100, daily: 10 },
    domain: { total: 50, daily: 50 },
    other: { total: 50, daily: 10 },
  });

export const ROLE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  chief_of_staff: "Chief of Staff",
  research: "Research",
  strategy_product: "Strategy and Product",
  design: "Design",
  engineering: "Engineering",
  growth: "Growth",
  sales: "Sales",
  ops_finance: "Operations and Finance",
});

export function roleTitle(role: string): string {
  return ROLE_TITLES[role] ?? role.replace(/_/g, " ");
}

/** Status badge classes on top of `mono-label`. */
export const TASK_STATUS_CLASS: Readonly<Record<TaskStatus, string>> = Object.freeze({
  queued: "text-faint",
  running: "text-deep animate-pulse motion-reduce:animate-none",
  waiting_decision: "text-warning",
  done: "text-success",
  failed: "text-error",
});

export const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, string>> = Object.freeze({
  queued: "queued",
  running: "running",
  waiting_decision: "waiting",
  done: "done",
  failed: "failed",
});

/** M5: where a signal came from (PRO-1). */
export const SIGNAL_SOURCE_LABELS: Readonly<Record<SignalSource, string>> = Object.freeze({
  reddit: "Reddit",
  producthunt: "Product Hunt",
  google_trends: "Google Trends",
  competitor_sites: "Competitor sites",
  metrics: "Metrics",
  sentry: "Sentry",
});

export function signalSourceLabel(source: string): string {
  return source in SIGNAL_SOURCE_LABELS ? SIGNAL_SOURCE_LABELS[source as SignalSource] : source.replace(/_/g, " ");
}

/** The same words the brief uses for a signal's status: "card open", "held for next week", "fix opened", … */
export const SIGNAL_STATUS_LABELS: Readonly<Record<SignalStatus, string>> = SIGNAL_STATUS_WORDS;

export function signalStatusLabel(status: string): string {
  return status in SIGNAL_STATUS_LABELS ? SIGNAL_STATUS_LABELS[status as SignalStatus] : status.replace(/_/g, " ");
}

export const SIGNAL_STATUS_CLASS: Readonly<Record<SignalStatus, string>> = Object.freeze({
  new: "text-faint",
  scored: "text-faint",
  below_threshold: "text-faint",
  card_opened: "text-deep",
  deferred: "text-warning",
  capped: "text-warning",
  approved: "text-success",
  declined: "text-faint",
  converted: "text-success",
});

export function signalStatusClass(status: string): string {
  return status in SIGNAL_STATUS_CLASS ? SIGNAL_STATUS_CLASS[status as SignalStatus] : "text-faint";
}

export const TASK_TYPE_LABELS: Readonly<Record<TaskType, string>> = Object.freeze({
  market_report: "Market report",
  personas: "Personas",
  competitor_map: "Competitor map",
  prd: "PRD",
  business_plan: "Business plan",
  investor_deck: "Investor deck",
  brand_kit: "Brand kit",
  screen_designs: "Screen designs",
  build_site: "Website build",
  campaign_spec: "Campaign",
  lead_research: "Lead research",
  outreach_batch: "Outreach batch",
  plan_week: "Weekly plan",
  brief: "Morning brief",
  signal_research: "Signal research",
  fix_error: "Error fix",
});

export function taskTypeLabel(taskType: string): string {
  return taskType in TASK_TYPE_LABELS ? TASK_TYPE_LABELS[taskType as TaskType] : taskType.replace(/_/g, " ");
}

export const ARTIFACT_KIND_LABELS: Readonly<Partial<Record<ArtifactKind, string>>> = Object.freeze({
  build_report: "Build report",
  signal_report: "Signal report",
  incident_report: "Incident report",
  lead_list: "Lead list",
});

export function artifactKindLabel(kind: string): string {
  return ARTIFACT_KIND_LABELS[kind as ArtifactKind] ?? kind.replace(/_/g, " ");
}

/** One line per authority tier, shown on decision cards and action rows. */
export const TIER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  K0: "K0 · automatic",
  K1: "K1 · notified",
  K2: "K2 · your call",
  K3: "K3 · only you",
});

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

/** "due in 3 h", "due in 2 d" or "overdue", from an ISO timestamp. */
export function formatDue(iso: string, now: Date = new Date()): string {
  const ms = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(ms)) return "no deadline";
  if (ms <= 0) return "overdue";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "due within the hour";
  if (hours < 48) return `due in ${hours} h`;
  return `due in ${Math.round(hours / 24)} d`;
}

/** "answered 14:05" / "answered 12 Oct" for the collapsed list of decided cards. */
export function formatAnsweredAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

/** ISO date `n` days from now, for the goal due-date default. */
export function isoDateInDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
