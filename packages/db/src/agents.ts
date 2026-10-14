import { TIERS, type Tier } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";

export interface AgentRecord {
  readonly id: string;
  readonly role: string;
  readonly configRef: string;
  readonly maxActionTier: Tier;
  readonly enabled: boolean;
}

export const AgentRoleInputSchema = z.object({
  role: z.string().trim().min(1).max(60),
  configRef: z.string().trim().min(1).max(200),
  maxActionTier: z.enum(TIERS),
});
export type AgentRoleInput = z.infer<typeof AgentRoleInputSchema>;

const AGENT_COLUMNS = "id, role, config_ref, max_action_tier, enabled";

const AgentRowSchema = z.object({
  id: z.string(),
  role: z.string(),
  config_ref: z.string(),
  max_action_tier: z.enum(TIERS),
  enabled: z.boolean(),
});

const toRecord = (row: unknown): AgentRecord => {
  const r = AgentRowSchema.parse(row);
  return Object.freeze({ id: r.id, role: r.role, configRef: r.config_ref, maxActionTier: r.max_action_tier, enabled: r.enabled });
};

/**
 * Makes sure one agent row exists per role (idempotent). Re-running with a
 * changed config or tier updates the row; `enabled` is left untouched.
 */
export async function ensureAgentsForCompany(
  db: DbClient,
  companyId: string,
  roles: ReadonlyArray<{ readonly role: string; readonly configRef: string; readonly maxActionTier: Tier }>,
): Promise<void> {
  const id = UuidSchema.parse(companyId);
  const parsed = z.array(AgentRoleInputSchema).parse(roles);
  if (parsed.length === 0) return;
  const rows = parsed.map((r) => ({ company_id: id, role: r.role, config_ref: r.configRef, max_action_tier: r.maxActionTier }));
  const { error } = await db.from("agents").upsert(rows, { onConflict: "company_id,role" });
  if (error) throw dbError("Could not ensure agents", error);
}

/** Every agent of the company, ordered by role. */
export async function listAgents(db: DbClient, companyId: string): Promise<readonly AgentRecord[]> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("agents").select(AGENT_COLUMNS).eq("company_id", id).order("role", { ascending: true });
  if (error) throw dbError("Could not list agents", error);
  return Object.freeze((data ?? []).map(toRecord));
}
