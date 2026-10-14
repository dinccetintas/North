import { ACTION_KINDS, TIERS, type Tier } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { isJsonObject, toJson, UuidSchema } from "./json";

export const ACTION_STATUSES = ["executed", "notified", "blocked", "declined", "failed", "pending"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface ActionRecord {
  readonly id: string;
  readonly taskId: string | null;
  readonly agentRole: string;
  readonly kind: string;
  readonly tier: Tier;
  readonly description: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: ActionStatus;
  readonly externalRef: string | null;
  readonly decisionCardId: string | null;
  readonly autoRuleId: string | null;
  readonly sandbox: boolean;
  readonly createdAt: string;
}

export const RecordActionInputSchema = z.object({
  companyId: UuidSchema,
  taskId: UuidSchema.nullable().default(null),
  agentRole: z.string().trim().min(1).max(60),
  kind: z.enum(ACTION_KINDS),
  tier: z.enum(TIERS),
  description: z.string().trim().min(1).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(ACTION_STATUSES),
  externalRef: z.string().max(500).optional(),
  decisionCardId: UuidSchema.optional(),
  autoRuleId: UuidSchema.optional(),
  sandbox: z.boolean().default(true),
});
export type RecordActionInput = z.input<typeof RecordActionInputSchema>;

export const DEFAULT_RECENT_HOURS = 24;
const ACTION_COLUMNS = "id, task_id, agent_role, kind, tier, description, payload, status, external_ref, decision_card_id, auto_rule_id, sandbox, created_at";

const ActionRowSchema = z.object({
  id: z.string(),
  task_id: z.string().nullable(),
  agent_role: z.string(),
  kind: z.string(),
  tier: z.enum(TIERS),
  description: z.string(),
  payload: z.unknown(),
  status: z.enum(ACTION_STATUSES),
  external_ref: z.string().nullable(),
  decision_card_id: z.string().nullable(),
  auto_rule_id: z.string().nullable(),
  sandbox: z.boolean(),
  created_at: z.string(),
});

const toRecord = (row: unknown): ActionRecord => {
  const r = ActionRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    taskId: r.task_id,
    agentRole: r.agent_role,
    kind: r.kind,
    tier: r.tier,
    description: r.description,
    payload: Object.freeze(isJsonObject(r.payload) ? { ...r.payload } : {}),
    status: r.status,
    externalRef: r.external_ref,
    decisionCardId: r.decision_card_id,
    autoRuleId: r.auto_rule_id,
    sandbox: r.sandbox,
    createdAt: r.created_at,
  });
};

/**
 * Appends one action to the audit log (append-only). The database rejects K2
 * without a card or auto rule and K3 without a card (DEC-1), surfaced as `DbError`.
 */
export async function recordAction(db: DbClient, input: RecordActionInput): Promise<string> {
  const a = RecordActionInputSchema.parse(input);
  const { data, error } = await db
    .from("actions")
    .insert({
      company_id: a.companyId,
      task_id: a.taskId,
      agent_role: a.agentRole,
      kind: a.kind,
      tier: a.tier,
      description: a.description,
      payload: toJson(a.payload),
      status: a.status,
      external_ref: a.externalRef ?? null,
      decision_card_id: a.decisionCardId ?? null,
      auto_rule_id: a.autoRuleId ?? null,
      sandbox: a.sandbox,
    })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not record action", error);
  return data.id;
}

/** Actions of the last `sinceHours` hours, newest first. */
export async function listRecentActions(db: DbClient, companyId: string, sinceHours: number = DEFAULT_RECENT_HOURS): Promise<readonly ActionRecord[]> {
  const id = UuidSchema.parse(companyId);
  const hours = z.number().positive().max(24 * 365).parse(sinceHours);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data, error } = await db
    .from("actions")
    .select(ACTION_COLUMNS)
    .eq("company_id", id)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw dbError("Could not list recent actions", error);
  return Object.freeze((data ?? []).map(toRecord));
}
