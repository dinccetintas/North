import { ACTION_KINDS, TIERS, isHttpUrl, type ActionKind, type Tier } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
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
  /** The row this one replaced in the action's state chain; null for the first row. */
  readonly supersedes: string | null;
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

/** A later state of an existing action: the new row carries the new status and points at the row it supersedes. */
export const ActionTransitionInputSchema = z.object({
  actionId: UuidSchema,
  status: z.enum(ACTION_STATUSES),
  externalRef: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
});
export type ActionTransitionInput = z.input<typeof ActionTransitionInputSchema>;

export const DEFAULT_RECENT_HOURS = 24;
const ACTION_COLUMNS = "id, task_id, agent_role, kind, tier, description, payload, status, external_ref, decision_card_id, auto_rule_id, sandbox, supersedes, created_at";

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
  supersedes: z.string().nullable(),
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
    supersedes: r.supersedes,
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

/**
 * Appends the next state of an action (audit NFR: rows are never updated).
 * The new row copies the original's identity, keeps its external reference
 * unless a new one is given, and records `{ supersedes, note }` in its payload.
 * A row can be superseded once; the database's unique index backs this up.
 */
export async function recordActionTransition(db: DbClient, input: ActionTransitionInput): Promise<string> {
  const t = ActionTransitionInputSchema.parse(input);
  const original = await db.from("actions").select(`company_id, ${ACTION_COLUMNS}`).eq("id", t.actionId).maybeSingle();
  if (original.error) throw dbError("Could not load action", original.error);
  if (!original.data) throw new DbError(`Action ${t.actionId} not found`);
  const prev = toRecord(original.data);
  const companyId = original.data.company_id;

  const existing = await db.from("actions").select("id").eq("supersedes", prev.id).maybeSingle();
  if (existing.error) throw dbError("Could not check action chain", existing.error);
  if (existing.data) throw new DbError(`Action ${prev.id} was already superseded by ${existing.data.id}`);

  const { data, error } = await db
    .from("actions")
    .insert({
      company_id: companyId,
      task_id: prev.taskId,
      agent_role: prev.agentRole,
      kind: prev.kind,
      tier: prev.tier,
      description: prev.description,
      payload: toJson({ supersedes: prev.id, ...(t.note === undefined ? {} : { note: t.note }) }),
      status: t.status,
      external_ref: t.externalRef ?? prev.externalRef,
      decision_card_id: prev.decisionCardId,
      auto_rule_id: prev.autoRuleId,
      sandbox: prev.sandbox,
      supersedes: prev.id,
    })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not record action transition", error);
  return data.id;
}

const heads = (rows: readonly ActionRecord[]): readonly ActionRecord[] => {
  const superseded = new Set(rows.flatMap((r) => (r.supersedes ? [r.supersedes] : [])));
  return Object.freeze(rows.filter((r) => !superseded.has(r.id)));
};

/** Current state of every action of a task (chain heads only), oldest first. */
export async function headActionsForTask(db: DbClient, taskId: string): Promise<readonly ActionRecord[]> {
  const id = UuidSchema.parse(taskId);
  const { data, error } = await db.from("actions").select(ACTION_COLUMNS).eq("task_id", id).order("created_at", { ascending: true });
  if (error) throw dbError("Could not list task actions", error);
  return heads((data ?? []).map(toRecord));
}

/** Every action still pending on a card, oldest first: one for most cards, one per email for an outreach batch card (DEC-1). */
export async function pendingActionsForCard(db: DbClient, cardId: string): Promise<readonly ActionRecord[]> {
  const id = UuidSchema.parse(cardId);
  const { data, error } = await db.from("actions").select(ACTION_COLUMNS).eq("decision_card_id", id).order("created_at", { ascending: true });
  if (error) throw dbError("Could not load card actions", error);
  return Object.freeze(heads((data ?? []).map(toRecord)).filter((a) => a.status === "pending"));
}

/** The first action a card decides on, in its current state, or null when the card has no pending action (or it was already settled away). */
export async function pendingActionForCard(db: DbClient, cardId: string): Promise<ActionRecord | null> {
  return (await pendingActionsForCard(db, cardId))[0] ?? null;
}

/** Chain heads of one action kind from the last `sinceDays` days, newest first (outreach batches, cap cards). */
export async function listActionsByKind(db: DbClient, companyId: string, kind: ActionKind, sinceDays = 30): Promise<readonly ActionRecord[]> {
  const id = UuidSchema.parse(companyId);
  const k = z.enum(ACTION_KINDS).parse(kind);
  const days = z.number().positive().max(365).parse(sinceDays);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db.from("actions").select(ACTION_COLUMNS).eq("company_id", id).eq("kind", k).gte("created_at", since).order("created_at", { ascending: false });
  if (error) throw dbError("Could not list actions by kind", error);
  return heads((data ?? []).map(toRecord));
}

export interface SiteUrls {
  /** The latest production deploy that executed (M3 go-live). */
  readonly live: string | null;
  /** The latest preview deploy that ran (K1, notified). */
  readonly preview: string | null;
}

const DEPLOY_KINDS = ["deploy.production", "deploy.preview"] as const;
const DEPLOY_SCAN_LIMIT = 50;

/** The company's website as the action log knows it: the newest live URL and the newest preview URL (home "Website" line). */
export async function siteUrls(db: DbClient, companyId: string): Promise<SiteUrls> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db
    .from("actions")
    .select(ACTION_COLUMNS)
    .eq("company_id", id)
    .in("kind", [...DEPLOY_KINDS])
    .order("created_at", { ascending: false })
    .limit(DEPLOY_SCAN_LIMIT);
  if (error) throw dbError("Could not load deploy actions", error);
  const done = heads((data ?? []).map(toRecord)).filter((a) => (a.status === "executed" || a.status === "notified") && isHttpUrl(a.externalRef));
  const live = done.find((a) => a.kind === "deploy.production")?.externalRef ?? null;
  const preview = done.find((a) => a.kind === "deploy.preview")?.externalRef ?? null;
  return Object.freeze({ live, preview });
}

/** Actions of the last `sinceHours` hours, newest first; a superseded row is replaced by the head of its chain. */
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
  return heads((data ?? []).map(toRecord));
}
