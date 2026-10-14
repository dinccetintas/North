import { ActionSpecSchema, applyDefault, gate, type ActionSpec, type GateDecision } from "@north/core";
import {
  QuotaExceededError,
  answerCard,
  getCard,
  getKillSwitch,
  getTask,
  latestMetric,
  listActiveAutoRules,
  listBudgets,
  markTaskDone,
  markTaskWaiting,
  openCard,
  recordAction,
  recordActionTransition,
  recordLedgerEntry,
  recordMetric,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import type { WorkerDeps } from "../deps";

/** Outcome of gating one action inside the durable function. */
export type GatedAction =
  | { readonly kind: "executed" | "notified" | "blocked"; readonly actionId: string; readonly externalRef: string | null }
  | { readonly kind: "card"; readonly actionId: string; readonly cardId: string; readonly dueAt: string }
  | { readonly kind: "deferred"; readonly actionId: string };

const DEFAULT_CARD_WINDOW_MS = 24 * 3600 * 1000;

/** Internal action kinds never leave the platform; they are recorded and considered executed. */
const INTERNAL_KINDS: ReadonlySet<ActionSpec["kind"]> = new Set(["research", "draft", "artifact.write", "memory.write"]);

/**
 * Executes an approved action through the integrations adapters (sandbox in M2).
 * Kinds without an adapter yet return a sandbox no-op reference so the audit
 * trail shows exactly what was not done.
 */
export async function performAction(deps: WorkerDeps, action: ActionSpec): Promise<string> {
  const { integrations } = deps;
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const str = (key: string, fallback = ""): string => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);
  switch (action.kind) {
    case "ads.start": {
      const started = await integrations.ads.startCampaign({
        companyId: action.companyId,
        name: str("name", action.description),
        dailyBudgetUsd: typeof payload.dailyBudgetUsd === "number" ? payload.dailyBudgetUsd : (action.amountUsd ?? 0),
        audience: str("audience"),
        creativeMarkdown: str("creativeMarkdown"),
      });
      return started.campaignId;
    }
    case "ads.pause": {
      await integrations.ads.pauseCampaign(action.companyId, str("campaignId"));
      return `paused:${str("campaignId")}`;
    }
    case "email.send.first_contact":
    case "email.send.reply":
    case "support.reply.template":
    case "support.reply.custom": {
      const sent = await integrations.mail.send({
        companyId: action.companyId,
        to: str("to"),
        subject: str("subject", action.description),
        text: str("text"),
        kind: action.kind === "email.send.first_contact" ? "first_contact" : "reply",
      });
      return sent.messageId;
    }
    default:
      return INTERNAL_KINDS.has(action.kind) ? "internal" : `sandbox:noop:${action.kind}`;
  }
}

/**
 * Gates one requested action (DEC-1). `run` executes immediately, `notify` is
 * recorded for the brief, `block` is recorded, `card` opens a decision card and
 * records a pending action tied to it. Quota breaches defer the action: it is
 * stored as blocked with `quota_deferred` and retried later.
 */
export async function gateAction(deps: WorkerDeps, taskId: string, raw: ActionSpec): Promise<GatedAction> {
  const { db } = deps;
  const task = await getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const action = ActionSpecSchema.parse({ ...raw, companyId: task.companyId, agentRole: task.role });
  const [budgets, autoRules, killSwitchActive] = await Promise.all([
    listBudgets(db, task.companyId),
    listActiveAutoRules(db, task.companyId),
    getKillSwitch(db, task.companyId),
  ]);
  const decision: GateDecision = gate(action, {
    killSwitchActive,
    budgets,
    autoRules,
    cardDueAt: new Date(Date.now() + DEFAULT_CARD_WINDOW_MS).toISOString(),
  });
  const base = { companyId: task.companyId, taskId, agentRole: task.role, kind: action.kind, tier: decision.tier, description: action.description, sandbox: deps.integrations.mode === "sandbox" };
  const payload = { ...(action.payload ?? {}), spec: action, gate: decision.kind, reasons: [...decision.reasons] };

  if (decision.kind === "run") {
    const externalRef = await performAction(deps, action);
    const actionId = await recordAction(db, { ...base, payload, status: "executed", externalRef, ...(decision.autoRuleId ? { autoRuleId: decision.autoRuleId } : {}) });
    return { kind: "executed", actionId, externalRef };
  }
  if (decision.kind === "notify") {
    const actionId = await recordAction(db, { ...base, payload, status: "notified" });
    return { kind: "notified", actionId, externalRef: null };
  }
  if (decision.kind === "block") {
    const actionId = await recordAction(db, { ...base, payload, status: "blocked" });
    return { kind: "blocked", actionId, externalRef: null };
  }

  try {
    const card = await openCard(db, { ...decision.card, taskId });
    const actionId = await recordAction(db, { ...base, payload, status: "pending", decisionCardId: card.id });
    await markTaskWaiting(db, taskId);
    return { kind: "card", actionId, cardId: card.id, dueAt: card.dueAt };
  } catch (error) {
    if (!(error instanceof QuotaExceededError)) throw error;
    const actionId = await recordAction(db, { ...base, payload: { ...payload, quota_deferred: true }, status: "blocked" });
    await markTaskWaiting(db, taskId);
    return { kind: "deferred", actionId };
  }
}

/** Actions stored as quota-deferred for a task, so a retry re-gates them instead of re-running the agent. */
export async function deferredActionsFor(db: DbClient, task: TaskRecord): Promise<readonly ActionSpec[]> {
  const { data, error } = await db
    .from("actions")
    .select("id, payload, supersedes")
    .eq("task_id", task.id)
    .eq("status", "blocked")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not load deferred actions: ${error.message}`);
  const specs: ActionSpec[] = [];
  for (const row of data ?? []) {
    const payload = row.payload as { quota_deferred?: boolean; spec?: unknown; retried?: boolean };
    if (!payload?.quota_deferred || payload.retried) continue;
    const parsed = ActionSpecSchema.safeParse(payload.spec);
    if (parsed.success) {
      specs.push(parsed.data);
      await recordActionTransition(db, { actionId: row.id, status: "blocked", note: "retried" });
    }
  }
  return Object.freeze(specs);
}

export interface SettleInput {
  readonly taskId: string;
  readonly actionId: string;
  readonly cardId: string;
  /** The answered option, or null when the deadline passed without an answer. */
  readonly optionId: string | null;
}

export type SettleResult = { readonly settled: true; readonly outcome: "executed" | "declined"; readonly externalRef: string | null } | { readonly settled: false; readonly reason: string };

/**
 * Applies the decision to its pending action. A missing answer uses the card's
 * safe default (K2); K3 has none, so the action stays pending for the retry cron.
 */
export async function settleCard(deps: WorkerDeps, input: SettleInput): Promise<SettleResult> {
  const { db } = deps;
  const card = await getCard(db, input.cardId);
  if (!card) throw new Error(`card ${input.cardId} not found`);
  let optionId = input.optionId ?? card.answeredOptionId;
  if (!optionId) {
    optionId = applyDefault(card);
    if (!optionId) return { settled: false, reason: "K3 decision has no default; waiting for the CEO" };
    await answerCard(db, card.id, { optionId, answeredBy: "default" });
  }

  const original = await db.from("actions").select("payload").eq("id", input.actionId).single();
  const spec = ActionSpecSchema.safeParse((original.data?.payload as { spec?: unknown } | null)?.spec);
  if (optionId !== "approve" || !spec.success) {
    await recordActionTransition(db, { actionId: input.actionId, status: "declined", note: `option ${optionId}` });
    return { settled: true, outcome: "declined", externalRef: null };
  }
  const externalRef = await performAction(deps, spec.data);
  await recordActionTransition(db, { actionId: input.actionId, status: "executed", externalRef, note: `option ${optionId}` });
  return { settled: true, outcome: "executed", externalRef };
}

export interface FinishInput {
  readonly taskId: string;
  readonly artifactIds: readonly string[];
  readonly costUsd: number;
  readonly summary: string;
  readonly executedRefs: readonly string[];
  readonly unsettled: number;
}

/** Marks the task done with evidence (artifact or executed action ref) and records the outcome (OUT-1). */
export async function finishTask(deps: WorkerDeps, input: FinishInput): Promise<{ readonly status: "done" | "waiting_decision" | "failed" }> {
  const { db } = deps;
  const task = await getTask(db, input.taskId);
  if (!task) throw new Error(`task ${input.taskId} not found`);
  if (task.status === "done") return { status: "done" };
  if (input.unsettled > 0) return { status: "waiting_decision" };

  const evidenceRef = input.artifactIds[0] ?? input.executedRefs[0] ?? null;
  if (!evidenceRef) {
    const { markTaskFailed } = await import("@north/db");
    await markTaskFailed(db, task.id, "no artifact and no executed action: nothing verifiable to show (AGT-2)");
    return { status: "failed" };
  }
  const sandbox = deps.integrations.mode === "sandbox" || deps.runtime.name === "mock";
  const evidence = input.artifactIds[0]
    ? ({ kind: "artifact_id", ref: evidenceRef, verified: true, sandbox } as const)
    : ({ kind: "message_id", ref: evidenceRef, verified: true, sandbox } as const);
  if (task.status === "waiting_decision") {
    // Resume so the state machine allows completion.
    const { markTaskRunning } = await import("@north/db");
    await markTaskRunning(db, task.id);
  }
  await markTaskDone(db, task.id, { evidence, costUsd: input.costUsd, outputSummary: input.summary });
  await recordOutcome(db, task, input.artifactIds.length, input.costUsd);
  return { status: "done" };
}

/** OUT-1 for K0 work: the `artifacts` metric moves by the number produced. */
async function recordOutcome(db: DbClient, task: TaskRecord, produced: number, costUsd: number): Promise<void> {
  const before = (await latestMetric(db, task.companyId, "artifacts"))?.value ?? 0;
  const after = before + produced;
  await recordMetric(db, { companyId: task.companyId, metricKey: "artifacts", value: after, source: "worker" });
  await recordLedgerEntry(db, {
    companyId: task.companyId,
    taskId: task.id,
    metricKey: task.metricKey ?? "artifacts",
    before,
    after,
    costUsd,
    channel: task.role,
    note: `${task.taskType}: ${produced} artifact(s)`,
  });
}
