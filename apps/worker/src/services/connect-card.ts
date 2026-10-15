import { CONNECT_CARD_OPTIONS, PROVIDER_TITLES, type ActionSpec, type ConnectionProvider } from "@north/core";
import { QuotaExceededError, getTask, listPendingCardsForTask, markTaskWaiting, openCard, recordAction } from "@north/db";
import type { WorkerDeps } from "../deps";

export { isConnectCard } from "@north/core";
export const CONNECT_OPTION = CONNECT_CARD_OPTIONS.connected;
export const SKIP_OPTION = CONNECT_CARD_OPTIONS.skip;
const CONNECT_WINDOW_MS = 3 * 24 * 3600 * 1000;

export type ConnectCardOutcome = { readonly cardId: string; readonly reused: boolean } | { readonly deferred: true; readonly actionId: string };

/**
 * ONB-3: a task that needs an account the user has not connected becomes a
 * card instead of a crash. The card carries no action (nothing to execute);
 * answering "connected" re-dispatches the task, "skip" (the default) fails it
 * with a clear reason. Opening is idempotent per task and provider. When the
 * day's quota is spent the step is stored as quota-deferred (like any gated
 * action) and the task parks until `retry-deferred` re-dispatches it.
 */
export async function openConnectCard(deps: WorkerDeps, taskId: string, provider: ConnectionProvider, spec: ActionSpec): Promise<ConnectCardOutcome> {
  const { db } = deps;
  const task = await getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const existing = (await listPendingCardsForTask(db, taskId)).find((c) => c.actionKind === spec.kind && c.options.some((o) => o.id === CONNECT_OPTION));
  if (existing) return { cardId: existing.id, reused: true };
  const title = PROVIDER_TITLES[provider];
  try {
    const card = await openCard(db, {
      companyId: task.companyId,
      taskId,
      question: `Connect ${title} so ${task.role.replace(/_/g, " ")} can continue "${task.title}"?`,
      options: [
        { id: CONNECT_OPTION, label: `I connected ${title}` },
        { id: SKIP_OPTION, label: "Skip for now" },
      ],
      recommendedOptionId: CONNECT_OPTION,
      rationale: `The step "${spec.kind}" needs your ${title} account (Settings → Connections). Nothing runs until it is connected; skipping marks the task as not done.`,
      expectedImpact: null,
      costUsd: 0,
      dueAt: new Date(Date.now() + CONNECT_WINDOW_MS).toISOString(),
      defaultOptionId: SKIP_OPTION,
      tier: "K2",
      actionKind: spec.kind,
      mergeKey: `connect:${provider}`,
    });
    if (task.status === "running") await markTaskWaiting(db, taskId);
    return { cardId: card.id, reused: false };
  } catch (error) {
    if (!(error instanceof QuotaExceededError)) throw error;
    const actionId = await recordAction(db, {
      companyId: task.companyId,
      taskId,
      agentRole: task.role,
      kind: spec.kind,
      tier: "K1",
      description: `${spec.description} (waiting for the ${title} connect card: today's decisions are spent)`,
      payload: { spec, quota_deferred: true, connect: provider },
      status: "blocked",
      sandbox: deps.integrations.mode === "sandbox",
    });
    if (task.status === "running") await markTaskWaiting(db, taskId);
    return { deferred: true, actionId };
  }
}
