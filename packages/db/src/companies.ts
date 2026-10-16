import { PAUSED_REASONS, SenderIdentitySchema, type PausedReason, type SenderIdentity } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { entitlementErrorFrom } from "./entitlements";
import { DbError, dbError } from "./errors";
import { slugify, uniqueSlug } from "./slug";

export const CreateCompanyInputSchema = z.object({
  ownerId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  thesis: z.string().trim().min(10).max(4000),
  targetCustomer: z.string().trim().max(500).default(""),
  whyNow: z.string().trim().max(500).default(""),
});
export type CreateCompanyInput = z.input<typeof CreateCompanyInputSchema>;

export interface CompanySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly killSwitchActive: boolean;
  /** Who set the kill switch (M6): `user`, `subscription_ended` (billing; the owner cannot lift it) or `retention` (archived). Null while running. */
  readonly pausedReason: PausedReason | null;
}

const PausedReasonSchema = z.enum(PAUSED_REASONS);
const SUMMARY_COLUMNS = "id, name, slug, status, kill_switch_active, paused_reason";

type CompanyRow = { id: string; name: string; slug: string; status: string; kill_switch_active: boolean; paused_reason: string | null };

const toSummary = (row: CompanyRow): CompanySummary =>
  Object.freeze({ id: row.id, name: row.name, slug: row.slug, status: row.status, killSwitchActive: row.kill_switch_active, pausedReason: PausedReasonSchema.nullable().parse(row.paused_reason) });

/**
 * Creates a company with its first thesis version. Works under RLS (owner
 * client) or with the service client. Retries once on a slug collision. The
 * database refuses a company over the owner's plan or after the subscription
 * ended (`companies_within_entitlement`, M6): that is an `EntitlementError`.
 */
export async function createCompany(db: DbClient, raw: CreateCompanyInput): Promise<CompanySummary> {
  const input = CreateCompanyInputSchema.parse(raw);
  const attempt = async (slug: string) =>
    db
      .from("companies")
      .insert({ owner_id: input.ownerId, name: input.name, slug })
      .select(SUMMARY_COLUMNS)
      .single();

  let result = await attempt(slugify(input.name));
  if (result.error?.code === "23505") {
    result = await attempt(uniqueSlug(input.name));
  }
  if (result.error || !result.data) {
    throw entitlementErrorFrom(result.error) ?? new DbError(`Could not create company: ${result.error?.message ?? "no row returned"}`, result.error);
  }

  const thesis = await db.from("theses").insert({
    company_id: result.data.id,
    version: 1,
    text: input.thesis,
    target_customer: input.targetCustomer,
    why_now: input.whyNow,
  });
  if (thesis.error) {
    throw new DbError(`Company created but thesis failed: ${thesis.error.message}`, thesis.error);
  }

  return toSummary(result.data);
}

export async function getCompanyBySlug(db: DbClient, slug: string): Promise<CompanySummary | null> {
  const { data, error } = await db
    .from("companies")
    .select(SUMMARY_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new DbError(`Could not load company: ${error.message}`, error);
  return data ? toSummary(data) : null;
}

/** Company by id (worker and deep links), or null when missing or not visible under RLS. */
export async function getCompanyById(db: DbClient, companyId: string): Promise<CompanySummary | null> {
  const id = z.string().uuid().parse(companyId);
  const { data, error } = await db.from("companies").select(SUMMARY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new DbError(`Could not load company: ${error.message}`, error);
  return data ? toSummary(data) : null;
}

/** The user who owns the company (the one who answers its cards). Throws when the company is unknown or invisible. */
export async function companyOwnerId(db: DbClient, companyId: string): Promise<string> {
  const id = z.string().uuid().parse(companyId);
  const { data, error } = await db.from("companies").select("owner_id").eq("id", id).maybeSingle();
  if (error) throw new DbError(`Could not read company owner: ${error.message}`, error);
  if (!data) throw new DbError(`Company ${id} not found`);
  return data.owner_id;
}

export async function listCompanies(db: DbClient): Promise<readonly CompanySummary[]> {
  const { data, error } = await db.from("companies").select(SUMMARY_COLUMNS).order("created_at", { ascending: false });
  if (error) throw new DbError(`Could not list companies: ${error.message}`, error);
  return Object.freeze((data ?? []).map(toSummary));
}

/** True when the owner has stopped all agents for this company. Missing company counts as stopped (fail closed). */
export async function getKillSwitch(db: DbClient, companyId: string): Promise<boolean> {
  const { data, error } = await db.from("companies").select("kill_switch_active").eq("id", companyId).maybeSingle();
  if (error) throw new DbError(`Could not read kill switch: ${error.message}`, error);
  return data?.kill_switch_active ?? true;
}

/** A company the proactive crons serve: onboarded and not archived, with its owner's zone and brief hour (the brief, the quota day and the week follow them). */
export interface ActiveCompany {
  readonly companyId: string;
  readonly ownerId: string;
  readonly timezone: string;
  /** The owner's `BriefHour` (0-23, default 7): `briefTick` compares the owner-local hour with it (BRF-1, M6). */
  readonly briefHour: number;
  readonly name: string;
  readonly slug: string;
  /** A stopped company still gets its brief (which says so); the scans and the weekly plan skip it. */
  readonly killSwitchActive: boolean;
  readonly pausedReason: PausedReason | null;
}

const ActiveCompanyRowSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  slug: z.string(),
  kill_switch_active: z.boolean(),
  paused_reason: PausedReasonSchema.nullable(),
  owner: z.object({ timezone: z.string(), brief_hour: z.number().int() }),
});

/**
 * Service role (the hourly crons): every onboarded company that is `active` or
 * `paused` (kill switch on, by the owner or by billing), oldest first, with
 * the owner's zone and brief hour. Archived companies are left out (M6: a
 * paused company still gets its brief, which says why).
 */
export async function listActiveCompanies(db: DbClient): Promise<readonly ActiveCompany[]> {
  const { data, error } = await db
    .from("companies")
    .select("id, owner_id, name, slug, kill_switch_active, paused_reason, owner:users!inner(timezone, brief_hour)")
    .in("status", ["active", "paused"])
    .eq("onboarding_step", "done")
    .order("created_at", { ascending: true });
  if (error) throw new DbError(`Could not list active companies: ${error.message}`, error);
  return Object.freeze(
    (data ?? []).map((row) => {
      const r = ActiveCompanyRowSchema.parse(row);
      return Object.freeze({
        companyId: r.id,
        ownerId: r.owner_id,
        timezone: r.owner.timezone,
        briefHour: r.owner.brief_hour,
        name: r.name,
        slug: r.slug,
        killSwitchActive: r.kill_switch_active,
        pausedReason: r.paused_reason,
      });
    }),
  );
}

/** A Sentry project slug as Sentry forms them; mirrors the `companies_sentry_project_slug_check` constraint. */
export const SentryProjectSlugSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, "a Sentry project slug: lowercase letters, digits, '.', '_' or '-'");

/** The company whose Sentry project has this slug (the webhook's lookup), or null when no company claims it or the slug is not one Sentry forms (M5 review L3: never a throw). */
export async function companyBySentryProject(db: DbClient, slug: string): Promise<CompanySummary | null> {
  const s = SentryProjectSlugSchema.safeParse(slug);
  if (!s.success) return null;
  const { data, error } = await db.from("companies").select(SUMMARY_COLUMNS).eq("sentry_project_slug", s.data).maybeSingle();
  if (error) throw new DbError(`Could not load company by Sentry project: ${error.message}`, error);
  return data ? toSummary(data) : null;
}

/**
 * Links (or with `null` unlinks) the Sentry project whose issues become fix
 * tasks (PRO-2). Worker (service role) only since 0011 (M5 review M4): the
 * slug is a claim until a Sentry connection proves it (M6), so an owner's
 * client is refused by the column grant; slugs are unique across companies.
 */
export async function setSentryProject(db: DbClient, companyId: string, slug: string | null): Promise<void> {
  const id = z.string().uuid().parse(companyId);
  const s = SentryProjectSlugSchema.nullable().parse(slug);
  const { data, error } = await db.from("companies").update({ sentry_project_slug: s }).eq("id", id).select("id").maybeSingle();
  if (error) throw new DbError(`Could not set Sentry project: ${error.message}`, error);
  if (!data) throw new DbError(`Company ${id} not found or not yours to change`);
}

/**
 * Kill switch: flips the flag (and `status` between `active` and `paused`);
 * the worker reacts to `company/killswitch` / `company/resume`. The owner's
 * client records the reason `user` (the trigger does; the column is not
 * granted to owners) and cannot lift a `subscription_ended` pause. The worker
 * passes `subscription_ended` when billing ends; turning the switch off clears
 * the reason. A company the user already paused keeps `user` (billing never
 * touches it). An archived company is left as it is (see `unarchiveCompany`).
 */
export async function setKillSwitch(db: DbClient, companyId: string, active: boolean, reason?: PausedReason): Promise<void> {
  const r = reason === undefined ? undefined : PausedReasonSchema.parse(reason);
  const update = db
    .from("companies")
    .update({ kill_switch_active: active, status: active ? "paused" : "active", ...(active && r !== undefined ? { paused_reason: r } : {}) })
    .eq("id", companyId)
    .neq("status", "archived");
  // ADR 0014: billing never touches a pause the user set; only a running company takes the billing reason.
  const { error } = await (active && r === "subscription_ended" ? update.eq("kill_switch_active", false) : update);
  if (error) throw new DbError(`Could not update kill switch: ${error.message}`, error);
}

/** Worker only: every company of one owner (billing's effects, the retention sweep), oldest first, archived included. */
export async function listCompaniesByOwner(db: DbClient, ownerId: string): Promise<readonly CompanySummary[]> {
  const id = z.uuid().parse(ownerId);
  const { data, error } = await db.from("companies").select(SUMMARY_COLUMNS).eq("owner_id", id).order("created_at", { ascending: true });
  if (error) throw dbError("Could not list the owner's companies", error);
  return Object.freeze((data ?? []).map(toSummary));
}

async function updateCompanyState(db: DbClient, companyId: string, patch: { status: string; kill_switch_active: boolean; paused_reason?: PausedReason }, what: string): Promise<CompanySummary> {
  const id = z.uuid().parse(companyId);
  const { data, error } = await db.from("companies").update(patch).eq("id", id).select(SUMMARY_COLUMNS).maybeSingle();
  if (error) throw dbError(`Could not ${what} company`, error);
  if (!data) throw new DbError(`Company ${id} not found or not yours to change`);
  return toSummary(data);
}

/** RET-1, worker only: the retention sweep archives a company (`archived`, switch on, reason `retention`, `archived_at` set by the database). */
export function archiveCompany(db: DbClient, companyId: string): Promise<CompanySummary> {
  return updateCompanyState(db, companyId, { status: "archived", kill_switch_active: true, paused_reason: "retention" }, "archive");
}

/** RET-1, worker only: a new subscription before the purge reverses the archive (`active`, switch off, reason and `archived_at` cleared). */
export function unarchiveCompany(db: DbClient, companyId: string): Promise<CompanySummary> {
  return updateCompanyState(db, companyId, { status: "active", kill_switch_active: false }, "restore");
}

/**
 * CMP-1: who the company is in the words the law wants at the foot of every
 * outreach email, or null unless both the legal name and the postal address
 * are set and the outreach rules would print them (an empty or too short
 * value counts as unset, so the send is refused rather than footed badly).
 * Null too for a company that is missing or not visible under RLS.
 */
export async function getSenderIdentity(db: DbClient, companyId: string): Promise<SenderIdentity | null> {
  const id = z.uuid().parse(companyId);
  const { data, error } = await db.from("companies").select("legal_name, postal_address").eq("id", id).maybeSingle();
  if (error) throw dbError("Could not read the sender identity", error);
  const identity = SenderIdentitySchema.safeParse({ legalName: data?.legal_name, postalAddress: data?.postal_address });
  return identity.success ? Object.freeze(identity.data) : null;
}

/**
 * CMP-1: sets the sender identity. The owner does this as themselves (the
 * two columns are granted to owners, 0019); the worker may too. The identity
 * is validated by the same schema the outreach rules read it with.
 */
export async function setSenderIdentity(db: DbClient, companyId: string, identity: SenderIdentity): Promise<void> {
  const id = z.uuid().parse(companyId);
  const parsed = SenderIdentitySchema.parse(identity);
  const { data, error } = await db.from("companies").update({ legal_name: parsed.legalName, postal_address: parsed.postalAddress }).eq("id", id).select("id").maybeSingle();
  if (error) throw dbError("Could not set the sender identity", error);
  if (!data) throw new DbError(`Company ${id} not found or not yours to change`);
}
