import { applyDefault, evidenceKindFor, type ActionKind, type Evidence } from "@north/core";
import {
  answerCard,
  getCampaign,
  getCard,
  getTask,
  headActionsForTask,
  latestMetric,
  listActionsByKind,
  listOverdueCards,
  listPendingCardsForTask,
  markTaskDone,
  markTaskFailed,
  markTaskRunning,
  pendingActionsForCard,
  recordActionTransition,
  recordLedgerEntry,
  recordMetric,
  type ActionRecord,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import type { WorkerDeps } from "../deps";
import { listDeferredRows } from "./actions";
import { resumeCampaign, type ResumeReason } from "./campaigns";
import { CONNECT_OPTION, isConnectCard } from "./connect-card";
import { applyDeclined, loadActionRow, taskIdFromRef } from "./outcomes";
import type { StepRunner } from "./steps";
import { providerChecks, verifyEvidence } from "./verifier";

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
  | { readonly kind: "declined"; readonly cardId: string; readonly actionIds: readonly string[]; readonly taskId: string | null }
  | { readonly kind: "perform"; readonly cardId: string; readonly actionIds: readonly string[]; readonly taskId: string | null; readonly tier: ActionRecord["tier"] };

/**
 * Reads the card's answer and moves its pending actions (one for most cards,
 * one per email of a batch): declined now, or handed back to be performed and
 * completed as separate steps each. A connect card (ONB-3) has no action:
 * "connected" resumes the task, "skip" abandons it.
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
  const actions = await pendingActionsForCard(db, cardId);
  const first = actions[0];
  if (!first) return { kind: "nothing", cardId };
  const actionIds = Object.freeze(actions.map((a) => a.id));
  if (card.answeredOptionId !== "approve") {
    for (const action of actions) {
      await recordActionTransition(db, { actionId: action.id, status: "declined", note: `option ${card.answeredOptionId} by ${card.answeredBy ?? "user"}` });
      const row = await loadActionRow(db, action.id);
      if (row) await applyDeclined(deps, row);
    }
    return { kind: "declined", cardId, actionIds, taskId: first.taskId };
  }
  return { kind: "perform", cardId, actionIds, taskId: first.taskId, tier: first.tier };
}

export type FollowUp =
  | { readonly kind: "none" }
  | { readonly kind: "resumed" | "resume_failed"; readonly campaignId: string }
  /** A pursued signal created a research task; the Inngest function sends `task/dispatch` for it (PRO-1). */
  | { readonly kind: "dispatch"; readonly companyId: string; readonly taskId: string };

/**
 * What an executed action asks for next (the caller passes only actions it
 * just recorded `executed`): an approved cap raise resumes the campaign it
 * named (K1 `ads.resume` through the gate, its own steps); an approved
 * signal card hands back the research task to dispatch. A resume that the
 * caps refuse leaves the campaign paused.
 */
export async function followUp(deps: WorkerDeps, step: StepRunner, actionId: string, index: number): Promise<FollowUp> {
  const row = await step.run(`follow-up-${index}-load`, () => loadActionRow(deps.db, actionId));
  if (row?.kind === "signal.pursue") {
    // The executed transition row (the chain head that supersedes the pending one) carries the `task:<id>` reference.
    const ref = await step.run(`follow-up-${index}-ref`, async () => (await listActionsByKind(deps.db, row.companyId, "signal.pursue")).find((a) => a.supersedes === actionId)?.externalRef ?? null);
    const taskId = ref ? taskIdFromRef(ref) : null;
    return taskId ? { kind: "dispatch", companyId: row.companyId, taskId } : { kind: "none" };
  }
  if (!row || row.kind !== "budget.cap.raise") return { kind: "none" };
  const campaignId = row.spec?.payload?.resumeCampaignId;
  if (typeof campaignId !== "string") return { kind: "none" };
  const campaign = await step.run(`follow-up-${index}-campaign`, () => getCampaign(deps.db, row.companyId, campaignId));
  if (!campaign) return { kind: "none" };
  const reason: ResumeReason = "cap_raised";
  const run = await resumeCampaign(deps, step, campaign, reason, `follow-up-${index}-resume`);
  const ok = run.completed?.status === "notified" || run.completed?.status === "executed";
  return { kind: ok ? "resumed" : "resume_failed", campaignId };
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
export async function applyOverdueDefaults(deps: WorkerDeps, now: Date = deps.clock()): Promise<readonly DefaultedCard[]> {
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

interface Candidate {
  readonly kind: Evidence["kind"];
  readonly ref: string;
  readonly sandbox: boolean;
}

const usable = (action: ActionRecord): Candidate | null => {
  if (action.status !== "executed" && action.status !== "notified") return null;
  const kind = evidenceKindFor(action.kind as ActionKind);
  const ref = action.externalRef;
  if (!kind || !ref || NOT_EVIDENCE.has(ref) || ref.startsWith("sandbox:noop:")) return null;
  return { kind, ref, sandbox: action.sandbox };
};

/**
 * The evidence a task can show (AGT-2), strongest first: a live or preview
 * URL (the latest executed deploy), else the provider reference of what the
 * task made happen (the campaign id, the first message id), else its first
 * artifact. URLs were verified by the pipeline; provider references are
 * checked against the provider before the task is done.
 */
export function evidenceCandidates(task: TaskRecord, actions: readonly ActionRecord[], sandbox: boolean): readonly Candidate[] {
  const refs = actions.map(usable).filter((e): e is Candidate => e !== null);
  const urls = refs.filter((e) => e.kind === "url");
  const latestUrl = urls[urls.length - 1];
  const provider = refs.filter((e) => e.kind !== "url");
  const artifactId = task.result.artifactIds[0];
  return Object.freeze([...(latestUrl ? [{ ...latestUrl, sandbox }] : []), ...provider, ...(artifactId ? [{ kind: "artifact_id" as const, ref: artifactId, sandbox }] : [])]);
}

/** Backwards-compatible view: the strongest candidate as unverified-yet evidence, or null. */
export function evidenceFor(task: TaskRecord, actions: readonly ActionRecord[], sandbox: boolean): Evidence | null {
  const first = evidenceCandidates(task, actions, sandbox)[0];
  return first ? { kind: first.kind, ref: first.ref, verified: true, sandbox: first.sandbox } : null;
}

/** The first candidate the verifier confirms (provider references are checked live; URLs and artifacts were checked when made). */
async function verifiedEvidence(deps: WorkerDeps, task: TaskRecord, candidates: readonly Candidate[]): Promise<{ readonly evidence: Evidence | null; readonly detail: string }> {
  const checks = providerChecks(deps, task.companyId);
  let detail = "no artifact and no executed action: nothing verifiable to show";
  for (const c of candidates) {
    if (c.kind !== "campaign_id" && c.kind !== "message_id") return { evidence: { kind: c.kind, ref: c.ref, verified: true, sandbox: c.sandbox }, detail: "" };
    const check = await verifyEvidence({ db: deps.db, ...deps.verifier, ...checks }, c.kind, c.ref);
    if (check.verified) return { evidence: { kind: c.kind, ref: c.ref, verified: true, sandbox: c.sandbox }, detail: check.detail };
    detail = `${c.kind} ${c.ref} not verified: ${check.detail}`;
  }
  return { evidence: null, detail };
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
  // A quota-deferred step is still owed (DEC-3): the retry cron re-dispatches the task tomorrow; it is not done today.
  if ((await listDeferredRows(db, taskId)).length > 0) return { status: "waiting_decision" };
  const sandbox = deps.integrations.mode === "sandbox" || deps.runtime.name === "mock";
  const { evidence, detail } = await verifiedEvidence(deps, task, evidenceCandidates(task, actions, sandbox));
  if (task.status === "waiting_decision") await markTaskRunning(db, taskId);
  if (!evidence) {
    await markTaskFailed(db, taskId, `${detail} (AGT-2)`);
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
