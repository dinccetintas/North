import { applyDefault, evidenceKindFor, type ActionKind, type Evidence } from "@north/core";
import {
  answerCard,
  getCard,
  getTask,
  headActionsForTask,
  latestMetric,
  listOverdueCards,
  listPendingCardsForTask,
  markTaskDone,
  markTaskFailed,
  markTaskRunning,
  pendingActionForCard,
  recordActionTransition,
  recordLedgerEntry,
  recordMetric,
  type ActionRecord,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import type { WorkerDeps } from "../deps";
import { CONNECT_OPTION, isConnectCard } from "./connect-card";

/**
 * Settlement of decision cards, outside the agent run (M2 security review
 * H1/H3/M3): the stored answer on the card is the only input, so a forged or
 * replayed `decision/answered` event can never execute anything.
 */
export type Settlement =
  | { readonly kind: "unanswered"; readonly cardId: string }
  | { readonly kind: "nothing"; readonly cardId: string }
  | { readonly kind: "resume"; readonly cardId: string; readonly taskId: string }
  | { readonly kind: "abandon"; readonly cardId: string; readonly taskId: string }
  | { readonly kind: "declined"; readonly cardId: string; readonly actionId: string; readonly taskId: string | null }
  | { readonly kind: "perform"; readonly cardId: string; readonly actionId: string; readonly taskId: string | null; readonly tier: ActionRecord["tier"] };

/**
 * Reads the card's answer and moves its pending action: declined now, or
 * handed back to be performed and completed as separate steps. A connect card
 * (ONB-3) has no action: "connected" resumes the task, "skip" abandons it.
 */
export async function settleDecision(deps: WorkerDeps, cardId: string): Promise<Settlement> {
  const { db } = deps;
  const card = await getCard(db, cardId);
  if (!card) throw new Error(`card ${cardId} not found`);
  if (!card.answeredAt || !card.answeredOptionId) return { kind: "unanswered", cardId };
  if (isConnectCard(card) && card.taskId) {
    const task = await getTask(db, card.taskId);
    if (!task || task.status !== "waiting_decision") return { kind: "nothing", cardId };
    if (card.answeredOptionId === CONNECT_OPTION) return { kind: "resume", cardId, taskId: card.taskId };
    await markTaskFailed(db, card.taskId, `${card.question} Skipped: the account was not connected.`);
    return { kind: "abandon", cardId, taskId: card.taskId };
  }
  const action = await pendingActionForCard(db, cardId);
  if (!action) return { kind: "nothing", cardId };
  if (card.answeredOptionId !== "approve") {
    await recordActionTransition(db, { actionId: action.id, status: "declined", note: `option ${card.answeredOptionId} by ${card.answeredBy ?? "user"}` });
    return { kind: "declined", cardId, actionId: action.id, taskId: action.taskId };
  }
  return { kind: "perform", cardId, actionId: action.id, taskId: action.taskId, tier: action.tier };
}

export interface DefaultedCard {
  readonly cardId: string;
  readonly companyId: string;
  readonly optionId: string;
}

/**
 * DEC-2 deadlines: K2 cards past due get their safe default (always decline);
 * K3 cards have none and stay open. Returns what was answered so the caller
 * can emit `decision/answered` for settlement.
 */
export async function applyOverdueDefaults(deps: WorkerDeps, now: Date = new Date()): Promise<readonly DefaultedCard[]> {
  const out: DefaultedCard[] = [];
  for (const card of await listOverdueCards(deps.db, now)) {
    const optionId = applyDefault(card);
    if (!optionId) continue;
    try {
      await answerCard(deps.db, card.id, { optionId, answeredBy: "default" });
      out.push({ cardId: card.id, companyId: card.companyId, optionId });
    } catch {
      // Answered meanwhile (race with the CEO): the settle function handles it.
    }
  }
  return Object.freeze(out);
}

const NOT_EVIDENCE = new Set(["internal"]);

const usable = (action: ActionRecord): { kind: Evidence["kind"]; ref: string } | null => {
  if (action.status !== "executed" && action.status !== "notified") return null;
  const kind = evidenceKindFor(action.kind as ActionKind);
  const ref = action.externalRef;
  if (!kind || !ref || NOT_EVIDENCE.has(ref) || ref.startsWith("sandbox:noop:")) return null;
  return { kind, ref };
};

/**
 * The best evidence a task can show (AGT-2), strongest first: a live or
 * preview URL (the latest executed deploy), else the first artifact, else a
 * provider reference such as a sent message id.
 */
export function evidenceFor(task: TaskRecord, actions: readonly ActionRecord[], sandbox: boolean): Evidence | null {
  const urls = actions.map(usable).filter((e): e is { kind: Evidence["kind"]; ref: string } => e !== null && e.kind === "url");
  const latestUrl = urls[urls.length - 1];
  if (latestUrl) return { kind: "url", ref: latestUrl.ref, verified: true, sandbox };
  const artifactId = task.result.artifactIds[0];
  if (artifactId) return { kind: "artifact_id", ref: artifactId, verified: true, sandbox };
  for (const action of actions) {
    const e = usable(action);
    if (e) return { kind: e.kind, ref: e.ref, verified: true, sandbox: action.sandbox };
  }
  return null;
}

export type FinishResult = { readonly status: "done" | "failed" | "waiting_decision" | "already" };

/**
 * Finishes a task once nothing is pending (AGT-2): verified evidence or
 * `failed`, never a silent done. Safe to call from every path that may be the
 * last one to touch the task; a task still waiting on a card is left alone.
 */
export async function finishTaskIfIdle(deps: WorkerDeps, taskId: string): Promise<FinishResult> {
  const { db } = deps;
  const task = await getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.status === "done" || task.status === "failed" || task.status === "queued") return { status: "already" };
  const actions = await headActionsForTask(db, taskId);
  if (actions.some((a) => a.status === "pending")) return { status: "waiting_decision" };
  if ((await listPendingCardsForTask(db, taskId)).length > 0) return { status: "waiting_decision" };
  const sandbox = deps.integrations.mode === "sandbox" || deps.runtime.name === "mock";
  const evidence = evidenceFor(task, actions, sandbox);
  if (task.status === "waiting_decision") await markTaskRunning(db, taskId);
  if (!evidence) {
    await markTaskFailed(db, taskId, "no artifact and no executed action: nothing verifiable to show (AGT-2)");
    return { status: "failed" };
  }
  await markTaskDone(db, taskId, { evidence, costUsd: task.result.costUsd, outputSummary: task.result.summary });
  await recordOutcome(db, task, task.result.artifactIds.length, task.result.costUsd);
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
