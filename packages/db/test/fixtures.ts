import type { CardDraft } from "@north/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

export async function deleteTestUser(user: TestUser): Promise<void> {
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

/** A second (or third) company for an existing owner; the decision quota is per company and day. */
export async function createCompanyFor(owner: TestUser, label: string): Promise<string> {
  const company = await createCompany(owner.client, { ownerId: owner.id, name: `${label} Co`, thesis: `${label}: a company whose thesis is long enough to pass validation.` });
  return company.id;
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
