import { ActionSpecSchema, batchPayload, gate, isActive, type ActionKind, type ActionSpec, type GateDecision, type Tier } from "@north/core";
import {
  QuotaExceededError,
  getCard,
  getEntitlementForCompany,
  getKillSwitch,
  getTask,
  headActionsForTask,
  listActiveAutoRules,
  listBudgets,
  markTaskWaiting,
  openCard,
  openFirstContactCard,
  recordAction,
  recordActionTransition,
  recordAutoFirstContact,
  type ActionRecord,
  type DbClient,
  type FirstContactOpen,
  type OpenCardInput,
  type TaskRecord,
} from "@north/db";
import type { WorkerDeps } from "../deps";
import { batchReuseRefusal, BATCH_MISMATCH, firstContactRefusal, heldRefusal } from "./batch-scope";
import { BudgetCapReachedError } from "./budget-check";
import { applyFailed, applyOutcome, loadActionRow } from "./outcomes";
import { performAction } from "./perform";
import { ConnectionRequiredError } from "./provider-auth";
import type { StepRunner } from "./steps";

export { performAction, type PerformResult } from "./perform";
export { deferredActionsFor, listDeferredRows, type DeferredRow } from "./deferred";

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

/** Kinds an adapter exists for. Anything else external is recorded `blocked` (`no_adapter`), never faked as executed. `support.reply.*` wait for a support inbox (M4 review H2). */
export const ADAPTER_KINDS: ReadonlySet<ActionKind> = new Set(["ads.start", "ads.pause", "ads.resume", "budget.cap.raise", "email.send.first_contact", "email.send.reply", "repo.create", "repo.push", "repo.pull_request", "deploy.preview", "deploy.production", "signal.pursue"]);

/** Kinds only the worker itself may request (M4 review H1, ADR 0012): a resume carries the worker's reason or a card; a cap raise is the collector's card; a signal card is the scan's. An agent asking for them is blocked. */
export const WORKER_ONLY_KINDS: ReadonlySet<ActionKind> = new Set(["ads.resume", "budget.cap.raise", "signal.pursue"]);

/** Kinds that stop spend: never refused for an ended subscription (M6 review L3). */
const STOPS_SPEND: ReadonlySet<ActionKind> = new Set(["ads.pause"]);
export const SUBSCRIPTION_ENDED = "subscription_ended";

/**
 * M6 review L3: nothing touches the outside world for an owner whose
 * entitlement has ended, whatever pause the company carries. An unknown
 * company has no entitlement here; the kill switch refuses it first
 * (`getKillSwitch` fails closed).
 */
async function subscriptionEnded(db: DbClient, companyId: string, kind: ActionKind): Promise<boolean> {
  if (STOPS_SPEND.has(kind)) return false;
  const entitlement = await getEntitlementForCompany(db, companyId);
  return entitlement !== null && !isActive(entitlement);
}

const specKey = (spec: ActionSpec): string => JSON.stringify({ kind: spec.kind, description: spec.description, amountUsd: spec.amountUsd ?? null, category: spec.category ?? null, payload: spec.payload ?? null });
const storedSpec = (a: ActionRecord): ActionSpec | null => {
  const parsed = ActionSpecSchema.safeParse((a.payload as { spec?: unknown }).spec);
  return parsed.success ? parsed.data : null;
};
const pendingOnCard = (a: ActionRecord): boolean => a.status === "pending" && a.decisionCardId !== null;

/** A pending action already opened for this exact spec (idempotent gating under step retries). */
function existingCardFor(actions: readonly ActionRecord[], spec: ActionSpec): ActionRecord | undefined {
  const key = specKey(spec);
  return actions.find((a) => {
    if (!pendingOnCard(a)) return false;
    const stored = storedSpec(a);
    return stored !== null && specKey(stored) === key;
  });
}

/** SLS-K2: a pending card of the same batch (`payload.batchId`), so five sends share one card and record one row each. */
export function existingBatchCard(actions: readonly ActionRecord[], spec: ActionSpec): ActionRecord | undefined {
  const batch = batchPayload(spec.payload);
  if (!batch) return undefined;
  return actions.find((a) => {
    if (!pendingOnCard(a) || a.kind !== spec.kind) return false;
    const stored = storedSpec(a);
    return stored !== null && batchPayload(stored.payload)?.batchId === batch.batchId;
  });
}

/** Who asks: an agent's run, or the worker's own effect (cap pause and card, day roll, kill-switch resume card). */
export type GateOrigin = "agent" | "worker";

/** Who an action is gated for: a task's run (parks the task on a card) or a standalone worker effect (cap pause, kill-switch resume card). */
export interface GateContext {
  readonly companyId: string;
  readonly taskId: string | null;
  readonly agentRole: string;
  readonly task: TaskRecord | null;
  /** Chain heads to reuse a pending card or batch against (idempotent gating). */
  readonly existing: readonly ActionRecord[];
  readonly origin: GateOrigin;
}

export interface GateOptions {
  readonly origin?: GateOrigin;
}

async function parkTask(db: DbClient, task: TaskRecord | null): Promise<void> {
  if (task?.status === "running") await markTaskWaiting(db, task.id);
}

/**
 * Gates one requested action for a task (DEC-1): the task supplies the company
 * and role, its chain heads give the cards to reuse, and a card parks it.
 * Agent requests are the default origin; the worker's own effects say so.
 */
export async function gateAction(deps: WorkerDeps, taskId: string, raw: ActionSpec, opts: GateOptions = {}): Promise<GatedAction> {
  const task = await getTask(deps.db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const existing = await headActionsForTask(deps.db, taskId);
  return gateFor(deps, { companyId: task.companyId, taskId, agentRole: task.role, task, existing, origin: opts.origin ?? "agent" }, raw);
}

/** Gates a worker-made action that belongs to no task run (the kill-switch resume card); `existing` gives the rows to reuse. */
export function gateStandalone(deps: WorkerDeps, raw: ActionSpec, existing: readonly ActionRecord[] = []): Promise<GatedAction> {
  return gateFor(deps, { companyId: raw.companyId, taskId: null, agentRole: raw.agentRole, task: null, existing, origin: "worker" }, raw);
}

type RecordBase = Omit<Parameters<typeof recordAction>[1], "payload" | "status">;

/** A refusal the gate records as `blocked` with its marker (`no_adapter`, `worker_only`, `batch_mismatch`); the raw reason stays in the payload. */
async function blockWith(db: DbClient, base: RecordBase, payload: Record<string, unknown>, marker: string, reason: string): Promise<GatedAction> {
  const actionId = await recordAction(db, { ...base, payload: { ...payload, [marker]: true, blocked_reason: reason.slice(0, 500) }, status: "blocked" });
  return { kind: "blocked", actionId, reason: marker };
}

/**
 * The gate itself. K0 internal kinds are recorded executed; every other
 * `run`/`notify` is recorded `pending` and returned as `execute`; `block` is
 * recorded; `card` opens a decision card and records a pending action tied to
 * it (reusing an existing one on retry, or the batch's card). Quota breaches
 * defer the action: stored as blocked with `quota_deferred` and retried later.
 */
export async function gateFor(deps: WorkerDeps, ctx: GateContext, raw: ActionSpec): Promise<GatedAction> {
  const { db } = deps;
  const action = ActionSpecSchema.parse({ ...raw, companyId: ctx.companyId, agentRole: ctx.agentRole });
  const [budgets, autoRules, killSwitchActive, ended] = await Promise.all([listBudgets(db, ctx.companyId), listActiveAutoRules(db, ctx.companyId), getKillSwitch(db, ctx.companyId), subscriptionEnded(db, ctx.companyId, action.kind)]);
  // The card's deadline and `opened_at` come from the worker's clock (ADR 0011); the database derives the quota day from `opened_at` in the owner's zone.
  const openedAt = deps.clock().toISOString();
  const decision: GateDecision = gate(action, { killSwitchActive, budgets, autoRules, cardDueAt: new Date(deps.clock().getTime() + DEFAULT_CARD_WINDOW_MS).toISOString() });
  const base = { companyId: ctx.companyId, taskId: ctx.taskId, agentRole: ctx.agentRole, kind: action.kind, tier: decision.tier, description: action.description, sandbox: deps.integrations.mode === "sandbox" };
  const payload = { ...(action.payload ?? {}), spec: action, gate: decision.kind, reasons: [...decision.reasons] };

  if (decision.kind === "block") {
    const actionId = await recordAction(db, { ...base, payload, status: "blocked" });
    return { kind: "blocked", actionId, reason: decision.reasons.join(", ") };
  }
  // No adapter yet: never open a card for it and never fake a reference (AGT-2).
  if (!INTERNAL_KINDS.has(action.kind) && !ADAPTER_KINDS.has(action.kind)) return blockWith(db, base, payload, "no_adapter", "no adapter for this kind");
  if (WORKER_ONLY_KINDS.has(action.kind) && ctx.origin !== "worker") return blockWith(db, base, payload, "worker_only", `${action.kind} is the platform's own effect; agents cannot request it`);
  if (ended) return blockWith(db, base, payload, SUBSCRIPTION_ENDED, "the owner's subscription has ended");
  if (decision.kind === "run" || decision.kind === "notify") {
    if (INTERNAL_KINDS.has(action.kind)) {
      const actionId = await recordAction(db, { ...base, payload, status: "executed", externalRef: "internal" });
      return { kind: "executed", actionId, externalRef: "internal" };
    }
    const autoRuleId = decision.kind === "run" ? decision.autoRuleId : undefined;
    if (action.kind === "email.send.first_contact" && autoRuleId) return autoFirstContact(deps, { ...base, payload, autoRuleId }, action, decision.tier);
    const actionId = await recordAction(db, { ...base, payload, status: "pending", ...(autoRuleId ? { autoRuleId } : {}) });
    return { kind: "execute", actionId, tier: decision.tier };
  }

  const reused = await reuseCard(deps, ctx, action, base, payload, decision.card.dueAt);
  if (reused) {
    if (reused.kind !== "blocked") await parkTask(db, ctx.task);
    return reused;
  }
  const refusal = action.kind === "email.send.first_contact" ? await firstContactRefusal(deps, ctx.companyId, action) : null;
  if (refusal) return blockWith(db, base, payload, BATCH_MISMATCH, refusal);
  try {
    const opened = await openCardWithAction(db, { ...decision.card, taskId: ctx.taskId, openedAt }, { ...base, payload });
    if (opened.kind === "held") return blockWith(db, base, payload, BATCH_MISMATCH, heldRefusal(opened.email));
    await parkTask(db, ctx.task);
    return { kind: "card", actionId: opened.actionId, cardId: opened.card.id, dueAt: opened.card.dueAt };
  } catch (error) {
    if (!(error instanceof QuotaExceededError)) throw error;
    const actionId = await recordAction(db, { ...base, payload: { ...payload, quota_deferred: true }, status: "blocked" });
    await parkTask(db, ctx.task);
    return { kind: "deferred", actionId };
  }
}

/**
 * SLS-K2: an auto rule approves a first contact only through the checks a
 * card would get. Its own recipient must be a new lead of the company that
 * no open batch holds (an auto-approved batch's earlier sends are already
 * settled, so each send is checked on its own); the pending row is written
 * under the company's outreach lock (0017). Then it runs like any `execute`.
 */
async function autoFirstContact(deps: WorkerDeps, row: RecordBase & { readonly payload: Record<string, unknown>; readonly autoRuleId: string }, action: ActionSpec, tier: Tier): Promise<GatedAction> {
  const refusal = await firstContactRefusal(deps, row.companyId, action, "own");
  if (refusal) return blockWith(deps.db, row, row.payload, BATCH_MISMATCH, refusal);
  const recorded = await recordAutoFirstContact(deps.db, row);
  if (recorded.kind === "held") return blockWith(deps.db, row, row.payload, BATCH_MISMATCH, heldRefusal(recorded.email));
  return { kind: "execute", actionId: recorded.actionId, tier };
}

/**
 * Opens the card and records the pending action it decides on. A first
 * contact does both in one transaction under the company's outreach lock and
 * is refused `held` when another open first contact names a recipient (0017,
 * SLS-K2); every other kind opens the card, then records the row.
 */
async function openCardWithAction(db: DbClient, card: OpenCardInput, action: RecordBase & { readonly payload: Record<string, unknown> }): Promise<FirstContactOpen> {
  if (action.kind === "email.send.first_contact") return openFirstContactCard(db, { card, action });
  const opened = await openCard(db, card);
  const actionId = await recordAction(db, { ...action, status: "pending", decisionCardId: opened.id });
  return { kind: "opened", card: opened, actionId };
}

/**
 * An open card to reuse: the same spec's own pending row (step retry), or the
 * batch's card with a new pending row for this send when the send fits the
 * card's verified scope (SLS-K2, M4 review H3). Null when a card must be opened.
 */
async function reuseCard(deps: WorkerDeps, ctx: GateContext, action: ActionSpec, base: RecordBase, payload: Record<string, unknown>, dueAt: string): Promise<GatedAction | null> {
  const same = existingCardFor(ctx.existing, action);
  if (same?.decisionCardId) {
    const card = await getCard(deps.db, same.decisionCardId);
    return { kind: "card", actionId: same.id, cardId: same.decisionCardId, dueAt: card?.dueAt ?? dueAt };
  }
  const batch = existingBatchCard(ctx.existing, action);
  if (!batch?.decisionCardId) return null;
  const refusal = await batchReuseRefusal(deps, batch.decisionCardId, action);
  if (refusal) return blockWith(deps.db, base, payload, BATCH_MISMATCH, refusal);
  const card = await getCard(deps.db, batch.decisionCardId);
  const actionId = await recordAction(deps.db, { ...base, payload, status: "pending", decisionCardId: batch.decisionCardId });
  return { kind: "card", actionId, cardId: batch.decisionCardId, dueAt: card?.dueAt ?? dueAt };
}

export type PerformOutcome =
  | { readonly ok: true; readonly externalRef: string; readonly sandbox: boolean; readonly meta?: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly error: string; readonly connectionRequired?: string; readonly capReached?: true; readonly killed?: true; readonly ended?: true };

const KILLED: PerformOutcome = Object.freeze({ ok: false, error: "kill switch active", killed: true });
const ENDED: PerformOutcome = Object.freeze({ ok: false, error: "the owner's subscription has ended", ended: true });

/**
 * Loads the pending action and executes its stored spec. Provider failures
 * come back as data so the next step can record them. Under the kill switch
 * (M4 review H4) or an ended subscription (M6 review L3) nothing is
 * performed: the row stays pending and the resume re-settles its card.
 */
export async function performPending(deps: WorkerDeps, actionId: string): Promise<PerformOutcome> {
  const row = await loadActionRow(deps.db, actionId);
  if (!row) return { ok: false, error: `action ${actionId} not found` };
  if (row.status !== "pending") return { ok: false, error: `action ${actionId} is ${row.status}, not pending` };
  if (!row.spec) return { ok: false, error: "stored action spec is invalid" };
  if (await getKillSwitch(deps.db, row.companyId)) return KILLED;
  if (await subscriptionEnded(deps.db, row.companyId, row.spec.kind)) return ENDED;
  try {
    const result = await performAction(deps, row.spec, { decisionCardId: row.decisionCardId, actionId: row.id });
    return { ok: true, externalRef: result.externalRef, sandbox: result.sandbox, ...(result.meta ? { meta: result.meta } : {}) };
  } catch (cause) {
    if (cause instanceof ConnectionRequiredError) return { ok: false, error: cause.message, connectionRequired: cause.provider };
    if (cause instanceof BudgetCapReachedError) return { ok: false, error: cause.message, capReached: true };
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export interface CompletedAction {
  /** `pending` only when the kill switch or an ended subscription stopped the perform step: no transition was written. */
  readonly status: "executed" | "notified" | "failed" | "pending";
  readonly externalRef: string | null;
}

/**
 * Writes the outcome as a new row: `executed` (or `notified` for K1, which the
 * brief reports) with the reference, or `failed` with the reason. An executed
 * action then leaves its mark (campaign row, lead status) in the same step.
 */
export async function completeAction(deps: WorkerDeps, input: { readonly actionId: string; readonly tier: Tier; readonly outcome: PerformOutcome }): Promise<CompletedAction> {
  if (!input.outcome.ok) {
    if (input.outcome.killed || input.outcome.ended) return { status: "pending", externalRef: null };
    // A failed first contact gives its lead back (0018), and the failed row says so.
    const released = await applyFailed(deps, input.actionId);
    await recordActionTransition(deps.db, { actionId: input.actionId, status: "failed", note: `${released}${input.outcome.error}`.slice(0, 500) });
    return { status: "failed", externalRef: null };
  }
  const status = input.tier === "K1" ? "notified" : "executed";
  const row = await loadActionRow(deps.db, input.actionId);
  await recordActionTransition(deps.db, { actionId: input.actionId, status, externalRef: input.outcome.externalRef, note: input.outcome.sandbox ? "sandbox" : "live" });
  if (row) await applyOutcome(deps, row, input.outcome);
  return { status, externalRef: input.outcome.externalRef };
}

export interface GatedRun {
  readonly gated: GatedAction;
  readonly completed: CompletedAction | null;
}

/** Runs one gated external effect to completion as three durable steps: `<id>-gate`, `<id>-perform`, `<id>-record`. */
export async function runGated(deps: WorkerDeps, step: StepRunner, id: string, gateFn: () => Promise<GatedAction>): Promise<GatedRun> {
  const gated = await step.run(`${id}-gate`, gateFn);
  if (gated.kind !== "execute") return { gated, completed: null };
  const outcome = await step.run(`${id}-perform`, () => performPending(deps, gated.actionId));
  const completed = await step.run(`${id}-record`, () => completeAction(deps, { actionId: gated.actionId, tier: gated.tier, outcome }));
  return { gated, completed };
}
