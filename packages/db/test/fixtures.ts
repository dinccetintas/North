import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
