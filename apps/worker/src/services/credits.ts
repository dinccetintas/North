import { consumeEntry, localMonth, releaseEntry, type Usage } from "@north/core";
import { applyUsage, companyOwnerId, CreditFloorError, getProfile, insertCreditEntries, reserveCredit } from "@north/db";
import type { WorkerDeps } from "../deps";
import { reportWarning } from "../observability";

/**
 * BIL-2 (ADR 0014): one credit is one agent run, any role, any runtime. The
 * run's `consume` (`run:<agentRunId>`) is reserved at dispatch, before the
 * run starts (M6 review L9: `credit_reserve` refuses at a balance of 0 under
 * the per-user lock, so concurrent dispatches cannot start runs the balance
 * cannot cover), and the run is recorded under that id. The step that records
 * the run adds it to the owner's usage month; a reserved run that never
 * started gets its credit back (`release:<agentRunId>`).
 */

/** The run's facts the charge needs (an `AgentRunResult` fits). */
export interface ChargedRun {
  readonly usage: { readonly costUsd: number };
  readonly sandboxMinutes?: number;
}

/** What dispatch reserved: the credit (`reserved`: this call wrote it), or a refusal at a balance of 0. */
export type RunReservation = { readonly ok: true; readonly userId: string; readonly reserved: boolean } | { readonly ok: false; readonly userId: string; readonly reason: "credits_exhausted" };

/** L9: the run's credit, before the run starts. A refusal is `credits_exhausted`: the caller does not start the run. */
export async function reserveRun(deps: WorkerDeps, companyId: string, agentRunId: string): Promise<RunReservation> {
  const userId = await companyOwnerId(deps.db, companyId);
  const outcome = await reserveCredit(deps.db, userId, consumeEntry(agentRunId).ref);
  if (outcome === "refused") return Object.freeze({ ok: false, userId, reason: "credits_exhausted" });
  return Object.freeze({ ok: true, userId, reserved: outcome === "reserved" });
}

/** The reserved run did not start (the runtime threw, the task changed under it): one `release` gives the credit back. */
export async function releaseRun(deps: WorkerDeps, agentRunId: string, reservation: RunReservation): Promise<void> {
  if (!reservation.ok || !reservation.reserved) return;
  await insertCreditEntries(deps.db, reservation.userId, [releaseEntry(agentRunId)]);
}

/** Writes the run's `consume` after the fact; true when this call inserted it, false when the ref was already there. */
export async function consumeForRun(deps: WorkerDeps, userId: string, agentRunId: string): Promise<boolean> {
  const inserted = await insertCreditEntries(deps.db, userId, [consumeEntry(agentRunId)]);
  return inserted.length > 0;
}

export interface RunUsage {
  readonly userId: string;
  readonly timezone: string;
  readonly run: { readonly costUsd: number; readonly sandboxMinutes: number };
  /** Credits the run consumed: 1, or 0 when the floor refused its consume (the cost still counts). */
  readonly credits?: number;
}

/** `usage_apply` for one run on the owner-local month of the worker's clock. */
export function recordUsageForRun(deps: WorkerDeps, input: RunUsage): Promise<Usage> {
  const period = localMonth(input.timezone, deps.clock());
  return applyUsage(deps.db, { userId: input.userId, period, credits: input.credits ?? 1, costUsd: Math.max(0, input.run.costUsd), sandboxMinutes: Math.max(0, input.run.sandboxMinutes) });
}

export interface RunCharge {
  readonly userId: string;
  /** False when the run was already charged (a re-run step) or the credit floor refused it. */
  readonly consumed: boolean;
  readonly period: string;
}

/**
 * The run is charged and the usage month grows by its cost and sandbox
 * minutes. A run reserved at dispatch is already charged: its usage is added
 * once, here. Otherwise the consume is written now; the database's floor
 * (`-CREDIT_GRACE`) may refuse it, which is reported (the founder's Sentry
 * sees it) and never fails the run, and the run's cost still reaches `usage`
 * (L9: usage is never under-reported).
 */
export async function chargeRun(deps: WorkerDeps, companyId: string, agentRunId: string, run: ChargedRun, reservation?: RunReservation): Promise<RunCharge> {
  const userId = reservation?.userId ?? (await companyOwnerId(deps.db, companyId));
  const timezone = (await getProfile(deps.db, userId))?.timezone ?? "UTC";
  const period = localMonth(timezone, deps.clock());
  const usage = { userId, timezone, run: { costUsd: run.usage.costUsd, sandboxMinutes: run.sandboxMinutes ?? 0 } };
  if (reservation?.ok && reservation.reserved) {
    await recordUsageForRun(deps, usage);
    return Object.freeze({ userId, consumed: true, period });
  }
  let consumed: boolean;
  try {
    consumed = await consumeForRun(deps, userId, agentRunId);
  } catch (cause) {
    if (!(cause instanceof CreditFloorError)) throw cause;
    reportWarning(`[credits] credit floor reached: run ${agentRunId} of company ${companyId} was not charged`, { userId, agentRunId });
    await recordUsageForRun(deps, { ...usage, credits: 0 });
    return Object.freeze({ userId, consumed: false, period });
  }
  if (consumed) await recordUsageForRun(deps, usage);
  return Object.freeze({ userId, consumed, period });
}
