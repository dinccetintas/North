import { CAMPAIGN_STATUSES, METRIC_KEYS, type CampaignStatus, type MetricKey } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { IsoDateSchema, UuidSchema } from "./json";

/** The database trigger `campaigns_within_budget` refused an activation (BUD-1). */
export class BudgetCapError extends DbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "BudgetCapError";
  }
}

export const AD_PROVIDERS = ["meta_ads", "google_ads"] as const;
export type AdProvider = (typeof AD_PROVIDERS)[number];

/** One summary row per executed `ads.start`; numbers are cumulative as last collected. */
export interface CampaignRecord {
  readonly id: string;
  readonly companyId: string;
  readonly taskId: string | null;
  readonly actionId: string;
  readonly provider: AdProvider;
  readonly providerCampaignId: string;
  readonly name: string;
  readonly channel: AdProvider;
  readonly metricKey: MetricKey;
  readonly dailyBudgetUsd: number;
  readonly totalBudgetUsd: number;
  readonly landingUrl: string;
  readonly status: CampaignStatus;
  readonly pausedDay: string | null;
  readonly spentTodayUsd: number;
  readonly spentTotalUsd: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly lastCollectedAt: string | null;
  readonly lastError: string | null;
  readonly sandbox: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const RegisterCampaignInputSchema = z.object({
  companyId: UuidSchema,
  taskId: UuidSchema.nullable().default(null),
  actionId: UuidSchema,
  provider: z.enum(AD_PROVIDERS),
  providerCampaignId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  metricKey: z.enum(METRIC_KEYS),
  dailyBudgetUsd: z.number().nonnegative(),
  totalBudgetUsd: z.number().nonnegative(),
  landingUrl: z.string().max(2048).default(""),
  status: z.enum(CAMPAIGN_STATUSES).default("active"),
  sandbox: z.boolean().default(true),
});
export type RegisterCampaignInput = z.input<typeof RegisterCampaignInputSchema>;

export const CampaignTotalsSchema = z.object({
  spentTodayUsd: z.number().nonnegative().optional(),
  spentTotalUsd: z.number().nonnegative().optional(),
  impressions: z.number().int().nonnegative().optional(),
  clicks: z.number().int().nonnegative().optional(),
  conversions: z.number().int().nonnegative().optional(),
  lastCollectedAt: z.iso.datetime({ offset: true }).optional(),
});
export type CampaignTotals = z.input<typeof CampaignTotalsSchema>;

export interface SetCampaignStatusOptions {
  readonly pausedDay?: string | null;
  readonly lastError?: string | null;
}

export interface ListCampaignsOptions {
  readonly status?: readonly CampaignStatus[];
}

const CAMPAIGN_COLUMNS =
  "id, company_id, task_id, action_id, provider, provider_campaign_id, name, channel, metric_key, daily_budget_usd, total_budget_usd, landing_url, status, paused_day, spent_today_usd, spent_total_usd, impressions, clicks, conversions, last_collected_at, last_error, sandbox, created_at, updated_at";

const CampaignRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  task_id: z.string().nullable(),
  action_id: z.string(),
  provider: z.enum(AD_PROVIDERS),
  provider_campaign_id: z.string(),
  name: z.string(),
  channel: z.enum(AD_PROVIDERS),
  metric_key: z.enum(METRIC_KEYS),
  daily_budget_usd: z.coerce.number(),
  total_budget_usd: z.coerce.number(),
  landing_url: z.string(),
  status: z.enum(CAMPAIGN_STATUSES),
  paused_day: z.string().nullable(),
  spent_today_usd: z.coerce.number(),
  spent_total_usd: z.coerce.number(),
  impressions: z.coerce.number(),
  clicks: z.coerce.number(),
  conversions: z.coerce.number(),
  last_collected_at: z.string().nullable(),
  last_error: z.string().nullable(),
  sandbox: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Maps a raw row to the immutable `CampaignRecord`; throws when the row is malformed. */
export function toCampaignRecord(row: unknown): CampaignRecord {
  const r = CampaignRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    taskId: r.task_id,
    actionId: r.action_id,
    provider: r.provider,
    providerCampaignId: r.provider_campaign_id,
    name: r.name,
    channel: r.channel,
    metricKey: r.metric_key,
    dailyBudgetUsd: r.daily_budget_usd,
    totalBudgetUsd: r.total_budget_usd,
    landingUrl: r.landing_url,
    status: r.status,
    pausedDay: r.paused_day,
    spentTodayUsd: r.spent_today_usd,
    spentTotalUsd: r.spent_total_usd,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    lastCollectedAt: r.last_collected_at,
    lastError: r.last_error,
    sandbox: r.sandbox,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

const isBudgetCap = (error: { code?: string; message?: string } | null): boolean => Boolean(error && error.code === "23514" && /budget_cap/.test(error.message ?? ""));

const writeError = (context: string, error: { code?: string; message?: string } | null): DbError =>
  isBudgetCap(error) ? new BudgetCapError(`${context}: the ads budget cap refuses an active campaign`, error) : dbError(context, error);

async function campaignByActionId(db: DbClient, actionId: string): Promise<CampaignRecord | null> {
  const { data, error } = await db.from("campaigns").select(CAMPAIGN_COLUMNS).eq("action_id", actionId).maybeSingle();
  if (error) throw dbError("Could not load campaign by action", error);
  return data ? toCampaignRecord(data) : null;
}

/**
 * Registers the campaign an executed `ads.start` created (worker only).
 * Idempotent by action id: a second call returns the existing row untouched.
 * An activation over the ads cap is refused by the database (`BudgetCapError`).
 */
export async function registerCampaign(db: DbClient, input: RegisterCampaignInput): Promise<CampaignRecord> {
  const c = RegisterCampaignInputSchema.parse(input);
  const existing = await campaignByActionId(db, c.actionId);
  if (existing) return existing;
  const { data, error } = await db
    .from("campaigns")
    .insert({
      company_id: c.companyId,
      task_id: c.taskId,
      action_id: c.actionId,
      provider: c.provider,
      provider_campaign_id: c.providerCampaignId,
      name: c.name,
      channel: c.provider,
      metric_key: c.metricKey,
      daily_budget_usd: c.dailyBudgetUsd,
      total_budget_usd: c.totalBudgetUsd,
      landing_url: c.landingUrl,
      status: c.status,
      sandbox: c.sandbox,
    })
    .select(CAMPAIGN_COLUMNS)
    .single();
  if (error?.code === "23505") {
    const raced = await campaignByActionId(db, c.actionId);
    if (raced) return raced;
  }
  if (error || !data) throw writeError("Could not register campaign", error);
  return toCampaignRecord(data);
}

/** One campaign of the company by id, or null when it does not exist, belongs to another company or is not visible under RLS (M4 review M3). */
export async function getCampaign(db: DbClient, companyId: string, campaignId: string): Promise<CampaignRecord | null> {
  const company = UuidSchema.parse(companyId);
  const id = UuidSchema.parse(campaignId);
  const { data, error } = await db.from("campaigns").select(CAMPAIGN_COLUMNS).eq("company_id", company).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load campaign", error);
  return data ? toCampaignRecord(data) : null;
}

/** The campaign the provider knows by this id (`sandbox:campaign:…` or the Meta id), or null. */
export async function getCampaignByProviderId(db: DbClient, companyId: string, providerCampaignId: string): Promise<CampaignRecord | null> {
  const id = UuidSchema.parse(companyId);
  const pid = z.string().trim().min(1).max(200).parse(providerCampaignId);
  const { data, error } = await db.from("campaigns").select(CAMPAIGN_COLUMNS).eq("company_id", id).eq("provider_campaign_id", pid).maybeSingle();
  if (error) throw dbError("Could not load campaign by provider id", error);
  return data ? toCampaignRecord(data) : null;
}

/** Campaigns of the company, oldest first, optionally filtered by status. */
export async function listCampaigns(db: DbClient, companyId: string, opts: ListCampaignsOptions = {}): Promise<readonly CampaignRecord[]> {
  const id = UuidSchema.parse(companyId);
  const base = db.from("campaigns").select(CAMPAIGN_COLUMNS).eq("company_id", id);
  const filtered = opts.status && opts.status.length > 0 ? base.in("status", z.array(z.enum(CAMPAIGN_STATUSES)).parse(opts.status)) : base;
  const { data, error } = await filtered.order("created_at", { ascending: true });
  if (error) throw dbError("Could not list campaigns", error);
  return Object.freeze((data ?? []).map(toCampaignRecord));
}

/**
 * Moves a campaign to a new status (worker only). `pausedDay` records the day a
 * cap pause started (the day roll resumes it); `lastError` keeps a failed
 * provider call. Becoming `active` is checked by the database against the ads
 * cap (`BudgetCapError`).
 */
export async function setCampaignStatus(db: DbClient, campaignId: string, status: CampaignStatus, opts: SetCampaignStatusOptions = {}): Promise<CampaignRecord> {
  const id = UuidSchema.parse(campaignId);
  const next = z.enum(CAMPAIGN_STATUSES).parse(status);
  const pausedDay = opts.pausedDay === undefined ? {} : { paused_day: IsoDateSchema.nullable().parse(opts.pausedDay) };
  const lastError = opts.lastError === undefined ? {} : { last_error: z.string().max(2000).nullable().parse(opts.lastError) };
  const { data, error } = await db.from("campaigns").update({ status: next, ...pausedDay, ...lastError }).eq("id", id).select(CAMPAIGN_COLUMNS).maybeSingle();
  if (error) throw writeError("Could not update campaign status", error);
  if (!data) throw new DbError(`Campaign ${id} not found or not writable`);
  return toCampaignRecord(data);
}

/** Writes the cumulative figures the collector read from the provider (worker only). */
export async function updateCampaignTotals(db: DbClient, campaignId: string, totals: CampaignTotals): Promise<CampaignRecord> {
  const id = UuidSchema.parse(campaignId);
  const t = CampaignTotalsSchema.parse(totals);
  const patch = {
    ...(t.spentTodayUsd === undefined ? {} : { spent_today_usd: t.spentTodayUsd }),
    ...(t.spentTotalUsd === undefined ? {} : { spent_total_usd: t.spentTotalUsd }),
    ...(t.impressions === undefined ? {} : { impressions: t.impressions }),
    ...(t.clicks === undefined ? {} : { clicks: t.clicks }),
    ...(t.conversions === undefined ? {} : { conversions: t.conversions }),
    ...(t.lastCollectedAt === undefined ? {} : { last_collected_at: t.lastCollectedAt }),
  };
  const { data, error } = await db.from("campaigns").update(patch).eq("id", id).select(CAMPAIGN_COLUMNS).maybeSingle();
  if (error) throw dbError("Could not update campaign totals", error);
  if (!data) throw new DbError(`Campaign ${id} not found or not writable`);
  return toCampaignRecord(data);
}

const COLLECTABLE_STATUSES: readonly CampaignStatus[] = ["active", "paused_cap"];
const FIRST_CONTACT_KIND = "email.send.first_contact";

/**
 * Service role (the hourly fan-out): ids of companies with a campaign that is
 * `active` or `paused_cap`, or an executed first-contact send in the last
 * `sinceDays` days, whose kill switch is off.
 */
export async function listCompaniesWithCollectables(db: DbClient, sinceDays = 30): Promise<readonly string[]> {
  const days = z.number().positive().max(365).parse(sinceDays);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [campaigns, sends] = await Promise.all([
    db.from("campaigns").select("company_id").in("status", [...COLLECTABLE_STATUSES]),
    db.from("actions").select("company_id").eq("kind", FIRST_CONTACT_KIND).eq("status", "executed").gte("created_at", since),
  ]);
  if (campaigns.error) throw dbError("Could not list collectable campaigns", campaigns.error);
  if (sends.error) throw dbError("Could not list recent sends", sends.error);
  const ids = [...new Set([...(campaigns.data ?? []), ...(sends.data ?? [])].map((r) => r.company_id))];
  if (ids.length === 0) return Object.freeze([]);
  const { data, error } = await db.from("companies").select("id").in("id", ids).eq("kill_switch_active", false).order("created_at", { ascending: true });
  if (error) throw dbError("Could not filter collectable companies", error);
  return Object.freeze((data ?? []).map((r) => r.id));
}
