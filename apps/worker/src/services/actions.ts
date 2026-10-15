import { ActionSpecSchema, gate, type ActionKind, type ActionSpec, type GateDecision, type Tier } from "@north/core";
import {
  QuotaExceededError,
  getCard,
  getKillSwitch,
  getTask,
  headActionsForTask,
  listActiveAutoRules,
  listBudgets,
  markTaskWaiting,
  openCard,
  recordAction,
  recordActionTransition,
  type ActionRecord,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import { RepoFileSchema } from "@north/integrations";
import { z } from "zod";
import type { WorkerDeps } from "../deps";
import { ConnectionRequiredError, providerAuthFor } from "./provider-auth";

/**
 * Outcome of gating one action. `execute` means a pending row exists and the
 * caller must run `performPending` and `completeAction` as separate durable
 * steps, so a crash between "did it" and "wrote it down" never repeats the
 * external call (audit NFR, M2 security review H4).
 */
export type GatedAction =
  | { readonly kind: "execute"; readonly actionId: string; readonly tier: Tier }
  | { readonly kind: "executed"; readonly actionId: string; readonly externalRef: string }
  | { readonly kind: "blocked"; readonly actionId: string; readonly reason: string }
  | { readonly kind: "card"; readonly actionId: string; readonly cardId: string; readonly dueAt: string }
  | { readonly kind: "deferred"; readonly actionId: string };

const DEFAULT_CARD_WINDOW_MS = 24 * 3600 * 1000;

/** Internal action kinds never leave the platform; they are recorded as executed without an adapter. */
export const INTERNAL_KINDS: ReadonlySet<ActionKind> = new Set(["research", "draft", "artifact.write", "memory.write"]);

/** Kinds an adapter exists for. Anything else external is recorded `blocked` (`no_adapter`), never faked as executed. */
export const ADAPTER_KINDS: ReadonlySet<ActionKind> = new Set([
  "ads.start",
  "ads.pause",
  "email.send.first_contact",
  "email.send.reply",
  "support.reply.template",
  "support.reply.custom",
  "repo.create",
  "repo.push",
  "deploy.preview",
  "deploy.production",
]);

export interface PerformResult {
  readonly externalRef: string;
  readonly sandbox: boolean;
  /** Provider facts later steps need (e.g. the repository's `fullName`), kept out of the reference itself. */
  readonly meta?: Readonly<Record<string, string>>;
}

const str = (payload: Record<string, unknown>, key: string, fallback = ""): string => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);
const FilesSchema = z.array(RepoFileSchema).min(1);

/**
 * Executes an action through the integrations adapters. Spend is capped by the
 * gated `amountUsd` (M2 security review H2): the adapter never sees a larger
 * figure than the card showed. Throws for provider failures; the caller records.
 */
export async function performAction(deps: WorkerDeps, action: ActionSpec): Promise<PerformResult> {
  const { integrations } = deps;
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  switch (action.kind) {
    case "ads.start": {
      const requested = typeof payload.dailyBudgetUsd === "number" ? payload.dailyBudgetUsd : (action.amountUsd ?? 0);
      const started = await integrations.ads.startCampaign({
        companyId: action.companyId,
        name: str(payload, "name", action.description),
        dailyBudgetUsd: Math.min(requested, action.amountUsd ?? requested),
        audience: str(payload, "audience"),
        creativeMarkdown: str(payload, "creativeMarkdown"),
      });
      return { externalRef: started.campaignId, sandbox: started.sandbox };
    }
    case "ads.pause": {
      await integrations.ads.pauseCampaign(action.companyId, str(payload, "campaignId"));
      return { externalRef: `paused:${str(payload, "campaignId")}`, sandbox: integrations.mode === "sandbox" };
    }
    case "email.send.first_contact":
    case "email.send.reply":
    case "support.reply.template":
    case "support.reply.custom": {
      const sent = await integrations.mail.send({
        companyId: action.companyId,
        to: str(payload, "to"),
        subject: str(payload, "subject", action.description),
        text: str(payload, "text"),
        kind: action.kind === "email.send.first_contact" ? "first_contact" : "reply",
      });
      return { externalRef: sent.messageId, sandbox: sent.sandbox };
    }
    case "repo.create": {
      const auth = await providerAuthFor(deps, action.companyId, action.kind);
      const repo = await integrations.code(auth).ensureRepo({ companyId: action.companyId, name: str(payload, "name") });
      return { externalRef: repo.url, sandbox: repo.sandbox, meta: { fullName: repo.fullName } };
    }
    case "repo.push": {
      const auth = await providerAuthFor(deps, action.companyId, action.kind);
      const pushed = await integrations.code(auth).pushTree({
        companyId: action.companyId,
        fullName: str(payload, "fullName"),
        message: str(payload, "message", action.description),
        files: FilesSchema.parse(payload.files),
      });
      return { externalRef: pushed.url, sandbox: pushed.sandbox };
    }
    case "deploy.preview":
    case "deploy.production": {
      const auth = await providerAuthFor(deps, action.companyId, action.kind);
      const deployment = await integrations.deploy(auth).create({
        companyId: action.companyId,
        name: str(payload, "name"),
        target: action.kind === "deploy.production" ? "production" : "preview",
        files: FilesSchema.parse(payload.files),
      });
      return { externalRef: deployment.url, sandbox: deployment.sandbox };
    }
    default:
      throw new Error(`No adapter for action kind ${action.kind}`);
  }
}

const specKey = (spec: ActionSpec): string => JSON.stringify({ kind: spec.kind, description: spec.description, amountUsd: spec.amountUsd ?? null, category: spec.category ?? null, payload: spec.payload ?? null });

/** A pending action already opened for this exact spec on this task (idempotent gating under step retries). */
function existingCardFor(actions: readonly ActionRecord[], spec: ActionSpec): ActionRecord | undefined {
  const key = specKey(spec);
  return actions.find((a) => a.status === "pending" && a.decisionCardId !== null && specKey(ActionSpecSchema.parse((a.payload as { spec?: unknown }).spec)) === key);
}

async function parkTask(db: DbClient, task: TaskRecord): Promise<void> {
  if (task.status === "running") await markTaskWaiting(db, task.id);
}

/**
 * Gates one requested action (DEC-1). K0 internal kinds are recorded executed;
 * every other `run`/`notify` is recorded `pending` and returned as `execute`;
 * `block` is recorded; `card` opens a decision card and records a pending
 * action tied to it (reusing an existing one on retry). Quota breaches defer the
 * action: stored as blocked with `quota_deferred` and retried later.
 */
export async function gateAction(deps: WorkerDeps, taskId: string, raw: ActionSpec): Promise<GatedAction> {
  const { db } = deps;
  const task = await getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const action = ActionSpecSchema.parse({ ...raw, companyId: task.companyId, agentRole: task.role });
  const [budgets, autoRules, killSwitchActive, existing] = await Promise.all([
    listBudgets(db, task.companyId),
    listActiveAutoRules(db, task.companyId),
    getKillSwitch(db, task.companyId),
    headActionsForTask(db, taskId),
  ]);
  const decision: GateDecision = gate(action, { killSwitchActive, budgets, autoRules, cardDueAt: new Date(Date.now() + DEFAULT_CARD_WINDOW_MS).toISOString() });
  const base = { companyId: task.companyId, taskId, agentRole: task.role, kind: action.kind, tier: decision.tier, description: action.description, sandbox: deps.integrations.mode === "sandbox" };
  const payload = { ...(action.payload ?? {}), spec: action, gate: decision.kind, reasons: [...decision.reasons] };

  if (decision.kind === "block") {
    const actionId = await recordAction(db, { ...base, payload, status: "blocked" });
    return { kind: "blocked", actionId, reason: decision.reasons.join(", ") };
  }
  if (!INTERNAL_KINDS.has(action.kind) && !ADAPTER_KINDS.has(action.kind)) {
    // No adapter yet: never open a card for it and never fake a reference (AGT-2).
    const actionId = await recordAction(db, { ...base, payload: { ...payload, no_adapter: true }, status: "blocked" });
    return { kind: "blocked", actionId, reason: "no_adapter" };
  }
  if (decision.kind === "run" || decision.kind === "notify") {
    if (INTERNAL_KINDS.has(action.kind)) {
      const actionId = await recordAction(db, { ...base, payload, status: "executed", externalRef: "internal" });
      return { kind: "executed", actionId, externalRef: "internal" };
    }
    const actionId = await recordAction(db, { ...base, payload, status: "pending", ...(decision.kind === "run" && decision.autoRuleId ? { autoRuleId: decision.autoRuleId } : {}) });
    return { kind: "execute", actionId, tier: decision.tier };
  }

  const reused = existingCardFor(existing, action);
  if (reused?.decisionCardId) {
    const card = await getCard(db, reused.decisionCardId);
    await parkTask(db, task);
    return { kind: "card", actionId: reused.id, cardId: reused.decisionCardId, dueAt: card?.dueAt ?? decision.card.dueAt };
  }
  try {
    const card = await openCard(db, { ...decision.card, taskId });
    const actionId = await recordAction(db, { ...base, payload, status: "pending", decisionCardId: card.id });
    await parkTask(db, task);
    return { kind: "card", actionId, cardId: card.id, dueAt: card.dueAt };
  } catch (error) {
    if (!(error instanceof QuotaExceededError)) throw error;
    const actionId = await recordAction(db, { ...base, payload: { ...payload, quota_deferred: true }, status: "blocked" });
    await parkTask(db, task);
    return { kind: "deferred", actionId };
  }
}

export type PerformOutcome =
  | { readonly ok: true; readonly externalRef: string; readonly sandbox: boolean; readonly meta?: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly error: string; readonly connectionRequired?: string };

/** Loads the pending action and executes its stored spec. Provider failures come back as data so the next step can record them. */
export async function performPending(deps: WorkerDeps, actionId: string): Promise<PerformOutcome> {
  const { data, error } = await deps.db.from("actions").select("payload, status").eq("id", actionId).single();
  if (error || !data) return { ok: false, error: `action ${actionId} not found` };
  if (data.status !== "pending") return { ok: false, error: `action ${actionId} is ${data.status}, not pending` };
  const spec = ActionSpecSchema.safeParse((data.payload as { spec?: unknown } | null)?.spec);
  if (!spec.success) return { ok: false, error: "stored action spec is invalid" };
  try {
    const result = await performAction(deps, spec.data);
    return { ok: true, externalRef: result.externalRef, sandbox: result.sandbox, ...(result.meta ? { meta: result.meta } : {}) };
  } catch (cause) {
    if (cause instanceof ConnectionRequiredError) return { ok: false, error: cause.message, connectionRequired: cause.provider };
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export interface CompletedAction {
  readonly status: "executed" | "notified" | "failed";
  readonly externalRef: string | null;
}

/** Writes the outcome as a new row: `executed` (or `notified` for K1, which the brief reports) with the reference, or `failed` with the reason. */
export async function completeAction(deps: WorkerDeps, input: { readonly actionId: string; readonly tier: Tier; readonly outcome: PerformOutcome }): Promise<CompletedAction> {
  if (input.outcome.ok) {
    const status = input.tier === "K1" ? "notified" : "executed";
    await recordActionTransition(deps.db, { actionId: input.actionId, status, externalRef: input.outcome.externalRef, note: input.outcome.sandbox ? "sandbox" : "live" });
    return { status, externalRef: input.outcome.externalRef };
  }
  await recordActionTransition(deps.db, { actionId: input.actionId, status: "failed", note: input.outcome.error.slice(0, 500) });
  return { status: "failed", externalRef: null };
}

export interface DeferredRow {
  readonly id: string;
  readonly companyId: string;
  readonly taskId: string;
  readonly spec: ActionSpec;
}

const DEFERRED_SCAN_LIMIT = 1000;

/**
 * Quota-deferred actions still waiting for a retry: blocked rows flagged
 * `quota_deferred` whose chain has not moved on. A retry appends a "retried"
 * transition, so the original row is superseded and never picked up twice.
 */
export async function listDeferredRows(db: DbClient, taskId?: string): Promise<readonly DeferredRow[]> {
  const base = db.from("actions").select("id, company_id, task_id, payload, supersedes").eq("status", "blocked").contains("payload", { quota_deferred: true }).not("task_id", "is", null);
  const { data, error } = await (taskId ? base.eq("task_id", taskId) : base).order("created_at", { ascending: true }).limit(DEFERRED_SCAN_LIMIT);
  if (error) throw new Error(`could not load deferred actions: ${error.message}`);
  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const superseded = ids.length === 0 ? new Set<string>() : await supersededAmong(db, ids);
  const out: DeferredRow[] = [];
  for (const row of rows) {
    if (superseded.has(row.id) || !row.task_id) continue;
    const parsed = ActionSpecSchema.safeParse((row.payload as { spec?: unknown }).spec);
    if (parsed.success) out.push({ id: row.id, companyId: row.company_id, taskId: row.task_id, spec: parsed.data });
  }
  return Object.freeze(out);
}

/** Ids among `ids` that some later row supersedes (the retry marker row carries no quota flag, so it is looked up explicitly). */
async function supersededAmong(db: DbClient, ids: readonly string[]): Promise<Set<string>> {
  const { data, error } = await db.from("actions").select("supersedes").in("supersedes", [...ids]);
  if (error) throw new Error(`could not check action chains: ${error.message}`);
  return new Set((data ?? []).flatMap((r) => (r.supersedes ? [r.supersedes] : [])));
}

/** Actions stored as quota-deferred for a task, so a retry re-gates them instead of re-running the agent. Each is marked retried. */
export async function deferredActionsFor(db: DbClient, task: TaskRecord): Promise<readonly ActionSpec[]> {
  const rows = await listDeferredRows(db, task.id);
  for (const row of rows) {
    await recordActionTransition(db, { actionId: row.id, status: "blocked", note: "retried" });
  }
  return Object.freeze(rows.map((r) => r.spec));
}
