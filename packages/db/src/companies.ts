import { z } from "zod";
import type { DbClient } from "./client";
import { DbError } from "./errors";
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
}

type CompanyRow = { id: string; name: string; slug: string; status: string; kill_switch_active: boolean };

const toSummary = (row: CompanyRow): CompanySummary =>
  Object.freeze({ id: row.id, name: row.name, slug: row.slug, status: row.status, killSwitchActive: row.kill_switch_active });

/**
 * Creates a company with its first thesis version. Works under RLS (owner
 * client) or with the service client. Retries once on a slug collision.
 */
export async function createCompany(db: DbClient, raw: CreateCompanyInput): Promise<CompanySummary> {
  const input = CreateCompanyInputSchema.parse(raw);
  const attempt = async (slug: string) =>
    db
      .from("companies")
      .insert({ owner_id: input.ownerId, name: input.name, slug })
      .select("id, name, slug, status, kill_switch_active")
      .single();

  let result = await attempt(slugify(input.name));
  if (result.error?.code === "23505") {
    result = await attempt(uniqueSlug(input.name));
  }
  if (result.error || !result.data) {
    throw new DbError(`Could not create company: ${result.error?.message ?? "no row returned"}`, result.error);
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
    .select("id, name, slug, status, kill_switch_active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new DbError(`Could not load company: ${error.message}`, error);
  return data ? toSummary(data) : null;
}

/** Company by id (worker and deep links), or null when missing or not visible under RLS. */
export async function getCompanyById(db: DbClient, companyId: string): Promise<CompanySummary | null> {
  const id = z.string().uuid().parse(companyId);
  const { data, error } = await db.from("companies").select("id, name, slug, status, kill_switch_active").eq("id", id).maybeSingle();
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
  const { data, error } = await db
    .from("companies")
    .select("id, name, slug, status, kill_switch_active")
    .order("created_at", { ascending: false });
  if (error) throw new DbError(`Could not list companies: ${error.message}`, error);
  return Object.freeze((data ?? []).map(toSummary));
}

/** True when the owner has stopped all agents for this company. Missing company counts as stopped (fail closed). */
export async function getKillSwitch(db: DbClient, companyId: string): Promise<boolean> {
  const { data, error } = await db.from("companies").select("kill_switch_active").eq("id", companyId).maybeSingle();
  if (error) throw new DbError(`Could not read kill switch: ${error.message}`, error);
  return data?.kill_switch_active ?? true;
}

/** Kill switch: flips the flag; the worker reacts to the `company/killswitch` event. */
export async function setKillSwitch(db: DbClient, companyId: string, active: boolean): Promise<void> {
  const { error } = await db
    .from("companies")
    .update({ kill_switch_active: active, status: active ? "paused" : "active" })
    .eq("id", companyId);
  if (error) throw new DbError(`Could not update kill switch: ${error.message}`, error);
}
