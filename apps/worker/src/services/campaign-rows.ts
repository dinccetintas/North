import type { ActionSpec, MetricKey } from "@north/core";
import { BudgetCapError, getTask, registerCampaign, setCampaignStatus, type CampaignRecord } from "@north/db";
import type { WorkerDeps } from "../deps";
import { ownerDay } from "./dates";

/**
 * The `campaigns` summary row (ADR 0009): one per executed `ads.start`, moved
 * by the worker alone. The audit of every start, pause and resume stays in
 * `actions`; these helpers only keep the row in step with what the provider
 * was told, and defer to the database trigger on the caps.
 */

export interface RegisterCampaignFor {
  readonly companyId: string;
  readonly taskId: string | null;
  readonly actionId: string;
  readonly spec: ActionSpec;
  readonly providerCampaignId: string;
  readonly landingUrl: string;
  readonly sandbox: boolean;
}

const num = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * Registers the campaign an executed `ads.start` created (idempotent by action
 * id). The trigger refuses an `active` row when the ads cap is spent; the
 * campaign then starts life `paused_cap` with the refusal as `last_error` and
 * the next collection pauses it at the provider too (BUD-1).
 */
export async function registerCampaignFor(deps: WorkerDeps, input: RegisterCampaignFor): Promise<CampaignRecord> {
  const payload = (input.spec.payload ?? {}) as Record<string, unknown>;
  const task = input.taskId ? await getTask(deps.db, input.taskId) : null;
  const metricKey: MetricKey = task?.metricKey ?? "signups";
  const base = {
    companyId: input.companyId,
    taskId: input.taskId,
    actionId: input.actionId,
    provider: "meta_ads" as const,
    providerCampaignId: input.providerCampaignId,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name : input.spec.description,
    metricKey,
    dailyBudgetUsd: num(payload.dailyBudgetUsd, input.spec.amountUsd ?? 0),
    totalBudgetUsd: input.spec.amountUsd ?? num(payload.dailyBudgetUsd, 0),
    landingUrl: input.landingUrl,
    sandbox: input.sandbox,
  };
  try {
    return await registerCampaign(deps.db, { ...base, status: "active" });
  } catch (error) {
    if (!(error instanceof BudgetCapError)) throw error;
    console.error(`[campaigns] ${input.providerCampaignId} registered paused: ${error.message}`);
    const row = await registerCampaign(deps.db, { ...base, status: "paused_cap" });
    return setCampaignStatus(deps.db, row.id, "paused_cap", { pausedDay: await ownerDay(deps, input.companyId), lastError: error.message.slice(0, 2000) });
  }
}

/** The row becomes `active`; when the database refuses (cap spent since), it stays paused for the cap with the owner's today as the pause day. */
export async function markCampaignActive(deps: WorkerDeps, campaign: Pick<CampaignRecord, "id" | "companyId">): Promise<CampaignRecord> {
  try {
    return await setCampaignStatus(deps.db, campaign.id, "active", { pausedDay: null, lastError: null });
  } catch (error) {
    if (!(error instanceof BudgetCapError)) throw error;
    console.error(`[campaigns] ${campaign.id} stays paused: ${error.message}`);
    return setCampaignStatus(deps.db, campaign.id, "paused_cap", { pausedDay: await ownerDay(deps, campaign.companyId), lastError: error.message.slice(0, 2000) });
  }
}

export type PauseReason = "cap" | "kill_switch" | "user";

const PAUSED_STATUS = { cap: "paused_cap", kill_switch: "paused_kill", user: "paused_user" } as const;

/** The row reflects a pause the provider confirmed; a cap pause remembers its owner-local day (the spec's, else today's) so the day roll can resume it. */
export async function markCampaignPaused(deps: WorkerDeps, campaign: Pick<CampaignRecord, "id" | "companyId">, reason: PauseReason, day?: string): Promise<CampaignRecord> {
  const pausedDay = reason === "cap" ? (day ?? (await ownerDay(deps, campaign.companyId))) : null;
  return setCampaignStatus(deps.db, campaign.id, PAUSED_STATUS[reason], { pausedDay, lastError: null });
}
