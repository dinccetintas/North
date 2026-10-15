import { SUBSCRIPTION_PLANS, type CardDraft, type SubscriptionPlanId } from "@north/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordAction } from "../src/actions";
import { ARTIFACTS_BUCKET } from "../src/artifacts";
import { EXPORTS_BUCKET } from "../src/exports";
import { listUserStoragePaths, purgeOwner } from "../src/purge";
import { upsertBudgets } from "../src/budgets";
import type { RegisterCampaignInput } from "../src/campaigns";
import { createCompany } from "../src/companies";
import type { Database } from "../src/types";
import { localSupabaseEnv } from "./env";

export type Client = SupabaseClient<Database>;
/** Untyped service client for tables not yet present in the generated types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawClient = SupabaseClient<any>;

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly client: Client;
}

const env = localSupabaseEnv();

export const service: Client = createClient<Database>(env.url, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export const raw: RawClient = service as unknown as RawClient;

/** A signed-out client: what an anonymous visitor of a public page holds (PUB-1). */
export const anon: Client = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Creates a confirmed user and returns an RLS-bound client signed in as that user. */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@north.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);

  const client = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`signIn failed: ${signedIn.error.message}`);
  return { id: created.data.user.id, email, client };
}

/**
 * Test cleanup through the one delete path (ADR 0016), as the smoke harnesses
 * do: end the entitlement with retention in the past, remove the user's
 * storage objects, `purge_owner`, then `auth.admin.deleteUser`. Since M6 every
 * user holds an append-only trial credit row, so a bare `deleteUser` can no
 * longer cascade. A user already purged by the test itself is skipped.
 */
export async function deleteTestUser(user: TestUser): Promise<void> {
  const { data: profile } = await raw.from("users").select("id").eq("id", user.id).maybeSingle();
  if (profile) {
    await endEntitlement(user.id, { retentionPassed: true });
    const paths = await listUserStoragePaths(service, user.id);
    for (const bucket of [ARTIFACTS_BUCKET, EXPORTS_BUCKET]) {
      const names = paths.filter((p) => p.bucket === bucket).map((p) => p.path);
      if (names.length > 0) await raw.storage.from(bucket).remove(names);
    }
    await purgeOwner(service, user.id, "test");
  }
  await service.auth.admin.deleteUser(user.id);
}

export interface OwnedCompany {
  readonly owner: TestUser;
  readonly companyId: string;
}

/** A fresh owner signed in under RLS plus one company (with its v1 thesis) created through the repository. */
export async function createOwnerWithCompany(label: string, thesis = "A test company whose thesis is long enough to pass validation."): Promise<OwnedCompany> {
  const owner = await createTestUser(label);
  const company = await createCompany(owner.client, { ownerId: owner.id, name: `${label} Co`, thesis });
  return { owner, companyId: company.id };
}

/**
 * M6 (BIL-1): every new owner is on a 1-company Solo trial and the trigger
 * `companies_within_entitlement` binds every client. A test that needs more
 * companies for one owner upgrades the owner through the service role first,
 * as the webhook would; the trigger is never loosened.
 */
export async function grantPlan(userId: string, planId: SubscriptionPlanId): Promise<void> {
  const plan = SUBSCRIPTION_PLANS[planId];
  const { error } = await raw
    .from("entitlements")
    .update({ plan_id: plan.id, status: "active", company_limit: plan.companyLimit, monthly_credits: plan.monthlyCredits, price_usd: plan.priceUsd, ended_at: null, retention_until: null })
    .eq("user_id", userId);
  if (error) throw new Error(`grantPlan failed: ${error.message}`);
}

const DAY_MS = 86_400_000;

/** Ends the owner's entitlement (service role). `retentionPassed` puts `retention_until` in the past, so the purge may run (the smoke cleanup, ADR 0016). */
export async function endEntitlement(userId: string, opts: { readonly retentionPassed?: boolean } = {}): Promise<void> {
  const now = Date.now();
  const endedAt = opts.retentionPassed ? now - 91 * DAY_MS : now;
  const { error } = await raw
    .from("entitlements")
    .update({ status: "ended", ended_at: new Date(endedAt).toISOString(), retention_until: new Date(endedAt + 90 * DAY_MS).toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(`endEntitlement failed: ${error.message}`);
}

/** A second (or third) company for an existing owner; the decision quota is per company and day. The owner's plan must allow it (`grantPlan`). */
export async function createCompanyFor(owner: TestUser, label: string): Promise<string> {
  const company = await createCompany(owner.client, { ownerId: owner.id, name: `${label} Co`, thesis: `${label}: a company whose thesis is long enough to pass validation.` });
  return company.id;
}

/** An ads budget plus one blocked `ads.start` row: what a campaign row needs to exist (M4). Returns the action id. */
export async function adsBudgetAndAction(companyId: string, budget: { daily: number; total: number } = { daily: 10, total: 100 }): Promise<string> {
  await upsertBudgets(service, companyId, [{ category: "ads", totalLimitUsd: budget.total, dailyLimitUsd: budget.daily }]);
  return recordAction(service, { companyId, taskId: null, agentRole: "growth", kind: "ads.start", tier: "K2", description: "Start the ad test", status: "blocked" });
}

/** The input `registerCampaign` receives from the worker after an executed `ads.start`; override fields per test. */
export function sampleCampaignInput(companyId: string, actionId: string, overrides: Partial<RegisterCampaignInput> = {}): RegisterCampaignInput {
  return Object.freeze({
    companyId,
    actionId,
    provider: "meta_ads",
    providerCampaignId: `sandbox:campaign:${Math.random().toString(36).slice(2, 10)}`,
    name: "Acme launch test",
    metricKey: "signups",
    dailyBudgetUsd: 10,
    totalBudgetUsd: 50,
    ...overrides,
  });
}

/** A valid K2 card draft the authority gate would produce for a $10 ad test; override fields per test. */
export function sampleCardDraft(companyId: string, overrides: Partial<CardDraft> = {}): CardDraft {
  return Object.freeze({
    companyId,
    question: "Start the $10/day ad test?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "decline", label: "Decline" },
    ],
    recommendedOptionId: "approve",
    rationale: "Tier K2 (spends_money). Requested by growth.",
    expectedImpact: null,
    costUsd: 10,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    defaultOptionId: "decline",
    tier: "K2",
    actionKind: "ads.start",
    mergeKey: "ads.start:ads",
    ...overrides,
  });
}
