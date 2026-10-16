import { consumeEntry, localMonth, type Usage } from "@north/core";
import { applyUsage, companyOwnerId, CreditFloorError, getProfile, insertCreditEntries } from "@north/db";
import type { WorkerDeps } from "../deps";
import { reportWarning } from "../observability";

/**
 * BIL-2 (ADR 0014): one credit is one agent run, any role, any runtime. The
 * step that records an `agent_runs` row also writes its `consume` entry
 * (`run:<agentRunId>`) and adds the run to the owner's usage month. The ref
 * makes the consume idempotent; the usage is applied only by the call that
 * inserted the consume, so a step that runs again counts nothing twice.
 */

/** The run's facts the charge needs (an `AgentRunResult` fits). */
export interface ChargedRun {
  readonly usage: { readonly costUsd: number };
  readonly sandboxMinutes?: number;
}

/** Writes the run's `consume`; true when this call inserted it, false when the ref was already there. */
export async function consumeForRun(deps: WorkerDeps, userId: string, agentRunId: string): Promise<boolean> {
  const inserted = await insertCreditEntries(deps.db, userId, [consumeEntry(agentRunId)]);
  return inserted.length > 0;
}

export interface RunUsage {
  readonly userId: string;
  readonly timezone: string;
  readonly run: { readonly costUsd: number; readonly sandboxMinutes: number };
}

/** `usage_apply` for one run on the owner-local month of the worker's clock. */
export function recordUsageForRun(deps: WorkerDeps, input: RunUsage): Promise<Usage> {
  const period = localMonth(input.timezone, deps.clock());
  return applyUsage(deps.db, { userId: input.userId, period, credits: 1, costUsd: Math.max(0, input.run.costUsd), sandboxMinutes: Math.max(0, input.run.sandboxMinutes) });
}

export interface RunCharge {
  readonly userId: string;
  /** False when the run was already charged (a re-run step) or the credit floor refused it. */
  readonly consumed: boolean;
  readonly period: string;
}

/**
 * The company's owner pays one credit for the run and the usage month grows
 * by its cost and sandbox minutes. The database's floor (`-CREDIT_GRACE`)
 * may refuse the consume when concurrent runs drained the balance: that is
 * reported (the founder's Sentry sees it) and never fails the run, which has
 * already happened.
 */
export async function chargeRun(deps: WorkerDeps, companyId: string, agentRunId: string, run: ChargedRun): Promise<RunCharge> {
  const userId = await companyOwnerId(deps.db, companyId);
  const timezone = (await getProfile(deps.db, userId))?.timezone ?? "UTC";
  const period = localMonth(timezone, deps.clock());
  let consumed: boolean;
  try {
    consumed = await consumeForRun(deps, userId, agentRunId);
  } catch (cause) {
    if (!(cause instanceof CreditFloorError)) throw cause;
    reportWarning(`[credits] credit floor reached: run ${agentRunId} of company ${companyId} was not charged`, { userId, agentRunId });
    return Object.freeze({ userId, consumed: false, period });
  }
  if (consumed) await recordUsageForRun(deps, { userId, timezone, run: { costUsd: run.usage.costUsd, sandboxMinutes: run.sandboxMinutes ?? 0 } });
  return Object.freeze({ userId, consumed, period });
}
