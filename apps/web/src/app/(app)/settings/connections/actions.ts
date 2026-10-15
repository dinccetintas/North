"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { revokeConnection, upsertConnection } from "@north/db";
import { EVENT } from "@north/core/events";
import { inngest } from "@/inngest/client";
import { oauthConfig, OauthProviderSchema } from "@/lib/oauth";
import { createClient, currentUser } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/(app)/c/[slug]/decisions/actions";

const ProviderInputSchema = z.object({ provider: OauthProviderSchema });
export type ProviderInput = z.input<typeof ProviderInputSchema>;

const CONNECTIONS_PATH = "/settings/connections";

/** Fixed messages for the browser; the cause goes to the server log only. */
const message = (error: unknown, fallback: string): string => {
  console.error("[connections]", fallback, error);
  return fallback;
};

/**
 * ONB-3 in sandbox: when the provider has no client id configured, "Connect
 * (sandbox)" records a connection without a token. The sandbox adapters need
 * none; live mode refuses it because the worker reads a real token.
 */
export async function connectSandboxAction(input: ProviderInput): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = ProviderInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown provider" };
  const { provider } = parsed.data;
  if (oauthConfig(provider)) return { ok: false, error: "This provider is configured for OAuth; use Connect instead" };
  if (process.env.INTEGRATIONS_MODE === "live") return { ok: false, error: "Sandbox connections are not allowed in live mode" };
  try {
    await upsertConnection(await createClient(), { userId: user.id, provider, scopes: ["sandbox"], accountLabel: "sandbox" });
  } catch (error) {
    return { ok: false, error: message(error, "Could not record the sandbox connection") };
  }
  revalidatePath(CONNECTIONS_PATH);
  return { ok: true, value: undefined };
}

/** Marks the connection revoked under RLS and asks the worker to drop the token (ADR 0008: the owner cannot reach it). */
export async function disconnectAction(input: ProviderInput): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = ProviderInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown provider" };
  const { provider } = parsed.data;
  try {
    await revokeConnection(await createClient(), user.id, provider);
  } catch (error) {
    return { ok: false, error: message(error, "Could not disconnect") };
  }
  try {
    await inngest.send({ name: EVENT.connectionRevoked, data: { userId: user.id, provider } });
  } catch (error) {
    console.error("[connections] could not send connection/revoked", provider, error);
  }
  revalidatePath(CONNECTIONS_PATH);
  return { ok: true, value: undefined };
}
