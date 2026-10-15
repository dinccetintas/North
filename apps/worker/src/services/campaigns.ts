import { capExceeded, type ActionSpec, type CapKind, type CampaignStatus } from "@north/core";
import { getBudget, listActionsByKind, listCampaigns, recordAction, setCampaignStatus, type CampaignRecord } from "@north/db";
import type { WorkerDeps } from "../deps";
import { gateAction, gateStandalone, runGated, type GatedAction, type GatedRun } from "./actions";
import { markCampaignPaused } from "./campaign-rows";
import { isBefore, todayIsoDate } from "./dates";
import { ConnectionRequiredError, providerAuthFor } from "./provider-auth";
import type { StepRunner } from "./steps";

export { registerCampaignFor as registerCampaign } from "./campaign-rows";

/** The kill switch SLA is 5 s; each provider pause gets this long, concurrently. */
export const KILL_PAUSE_TIMEOUT_MS = 4_000;
const GROWTH = "growth";

/** A worker-made campaign action is gated against the campaign's task when it still has one, else standalone; either way as the worker's own (M4 review H1). */
function gateCampaignAction(deps: WorkerDeps, campaign: CampaignRecord, spec: ActionSpec): Promise<GatedAction> {
  return campaign.taskId ? gateAction(deps, campaign.taskId, spec, { origin: "worker" }) : gateStandalone(deps, spec);
}

/** BUD-3, first half: pause the campaign at the provider (K1 `ads.pause` through the gate, `notified`) and mark the row `paused_cap` for the day. */
export function pauseForCap(deps: WorkerDeps, step: StepRunner, campaign: CampaignRecord, cap: CapKind, day: string = todayIsoDate(deps.clock()), stepId = `cap-pause-${campaign.id}`): Promise<GatedRun> {
  const spec: ActionSpec = {
    kind: "ads.pause",
    companyId: campaign.companyId,
    agentRole: GROWTH,
    description: `Pause ${campaign.name}: the ${cap} ads cap is reached`,
    payload: { campaignId: campaign.id, providerCampaignId: campaign.providerCampaignId, reason: "cap", cap, day },
  };
  return runGated(deps, step, stepId, () => gateCampaignAction(deps, campaign, spec));
}

export type ResumeReason = "cap_raised" | "day_roll";

/** K1 `ads.resume` through the gate (the original card approved this daily budget); the row becomes `active` unless the database refuses. */
export function resumeCampaign(deps: WorkerDeps, step: StepRunner, campaign: CampaignRecord, reason: ResumeReason, stepId = `resume-${campaign.id}`): Promise<GatedRun> {
  const why = reason === "day_roll" ? "a new day: the daily cap applies again" : "today's cap was raised";
  const spec: ActionSpec = {
    kind: "ads.resume",
    companyId: campaign.companyId,
    agentRole: GROWTH,
    description: `Resume ${campaign.name}: ${why}`,
    payload: { campaignId: campaign.id, providerCampaignId: campaign.providerCampaignId, reason },
  };
  return runGated(deps, step, stepId, () => gateCampaignAction(deps, campaign, spec));
}

/**
 * Day roll: campaigns paused for the daily cap on an earlier day resume by
 * themselves (K1); a total-cap pause never resumes without a card. Returns
 * the ids resumed.
 */
export async function resumeAfterDayRoll(deps: WorkerDeps, step: StepRunner, companyId: string, today: string = todayIsoDate(deps.clock())): Promise<readonly string[]> {
  const paused = (await listCampaigns(deps.db, companyId, { status: ["paused_cap"] })).filter((c) => c.pausedDay !== null && isBefore(c.pausedDay, today));
  if (paused.length === 0) return Object.freeze([]);
  const budget = await getBudget(deps.db, companyId, "ads");
  if (!budget || capExceeded(budget).total) return Object.freeze([]);
  const resumed: string[] = [];
  for (const campaign of paused) {
    const run = await resumeCampaign(deps, step, campaign, "day_roll", `day-roll-${campaign.id}`);
    if (run.completed?.status === "notified" || run.completed?.status === "executed") resumed.push(campaign.id);
  }
  return Object.freeze(resumed);
}

interface PauseAttempt {
  readonly campaign: CampaignRecord;
  readonly error: string | null;
}

const withTimeout = <T>(work: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });

async function pauseAtProvider(deps: WorkerDeps, campaigns: readonly CampaignRecord[], companyId: string): Promise<readonly PauseAttempt[]> {
  let ads: ReturnType<WorkerDeps["integrations"]["ads"]>;
  try {
    ads = deps.integrations.ads(await providerAuthFor(deps, companyId, "ads.pause"));
  } catch (cause) {
    const error = cause instanceof ConnectionRequiredError ? cause.message : cause instanceof Error ? cause.message : String(cause);
    return campaigns.map((campaign) => ({ campaign, error }));
  }
  return Promise.all(
    campaigns.map(async (campaign) => {
      try {
        await withTimeout(ads.pauseCampaign(companyId, campaign.providerCampaignId), KILL_PAUSE_TIMEOUT_MS, `pause ${campaign.providerCampaignId}`);
        return { campaign, error: null };
      } catch (cause) {
        return { campaign, error: cause instanceof Error ? cause.message : String(cause) };
      }
    }),
  );
}

export interface KillSwitchPause {
  readonly paused: readonly string[];
  readonly failed: readonly string[];
}

/** Rows the kill switch leaves alone: finished, or already paused by a kill switch. Every other row may still deliver at the provider (M4 review M4). */
const KILL_SKIP: ReadonlySet<CampaignStatus> = new Set(["ended", "paused_kill"]);

/**
 * BUD-4: the kill switch pauses every row that may still deliver (`active`,
 * and a `paused_cap` or `paused_user` row the provider may not have paused
 * yet) at the provider, concurrently with a 4 s timeout each, and records
 * one K1 `ads.pause` row with the ids (plus one `failed` row for what could
 * not be paused, which keeps its status with `last_error`). Active rows
 * become `paused_kill`; a cap pause keeps its status and day, so the day
 * roll and the cap card still own it. This is the one path that records
 * without `gate()`: under an active kill switch the gate's only verdict is
 * `block`, and the pause is the kill switch's own effect.
 */
export async function pauseForKillSwitch(deps: WorkerDeps, companyId: string): Promise<KillSwitchPause> {
  const active = (await listCampaigns(deps.db, companyId)).filter((c) => !KILL_SKIP.has(c.status));
  const attempts = active.length === 0 ? [] : await pauseAtProvider(deps, active, companyId);
  const paused = attempts.filter((a) => a.error === null).map((a) => a.campaign);
  const failed = attempts.filter((a) => a.error !== null);
  const sandbox = deps.integrations.mode === "sandbox";
  const base = { companyId, taskId: null, agentRole: "ops_finance", kind: "ads.pause" as const, tier: "K1" as const, sandbox };
  await recordAction(deps.db, {
    ...base,
    description: `Kill switch: paused ${paused.length} campaign(s)`,
    payload: { reason: "kill_switch", campaignIds: paused.map((c) => c.id), providerCampaignIds: paused.map((c) => c.providerCampaignId) },
    status: "notified",
  });
  if (failed.length > 0) {
    await recordAction(deps.db, {
      ...base,
      description: `Kill switch: ${failed.length} campaign(s) could not be paused`,
      payload: { reason: "kill_switch", campaignIds: failed.map((a) => a.campaign.id), errors: failed.map((a) => ({ campaignId: a.campaign.id, error: a.error?.slice(0, 500) ?? "" })) },
      status: "failed",
    });
    for (const a of failed) console.error(`[kill-switch] campaign ${a.campaign.id} not paused: ${a.error}`);
  }
  for (const campaign of paused.filter((c) => c.status === "active")) await markCampaignPaused(deps, campaign.id, "kill_switch");
  for (const a of failed) await setCampaignStatus(deps.db, a.campaign.id, a.campaign.status, { lastError: a.error?.slice(0, 2000) ?? null });
  return Object.freeze({ paused: Object.freeze(paused.map((c) => c.id)), failed: Object.freeze(failed.map((a) => a.campaign.id)) });
}

export type ResumeCardOutcome = { readonly kind: "none" } | { readonly kind: "card"; readonly cardId: string; readonly reused: boolean } | { readonly kind: "deferred" | "blocked" };

const KILL_SWITCH = "kill_switch";

/**
 * After `company/resume`: spend never resumes silently. Campaigns paused by
 * the kill switch wait for one K2 `ads.resume` card (requested tier K2,
 * default decline); an identical pending card is reused.
 */
export async function killSwitchResumeCard(deps: WorkerDeps, companyId: string): Promise<ResumeCardOutcome> {
  const paused = await listCampaigns(deps.db, companyId, { status: ["paused_kill"] });
  if (paused.length === 0) return { kind: "none" };
  const spec: ActionSpec = {
    kind: "ads.resume",
    companyId,
    agentRole: GROWTH,
    description: `Resume ${paused.length} campaign(s) paused by the kill switch: ${paused.map((c) => c.name).join(", ")}`.slice(0, 500),
    requestedTier: "K2",
    payload: { campaignIds: paused.map((c) => c.id), providerCampaignIds: paused.map((c) => c.providerCampaignId), campaignNames: paused.map((c) => c.name), reason: KILL_SWITCH },
  };
  const existing = (await listActionsByKind(deps.db, companyId, "ads.resume", 7)).filter((a) => a.status === "pending" && a.decisionCardId !== null);
  const gated = await gateStandalone(deps, spec, existing);
  if (gated.kind === "card") return { kind: "card", cardId: gated.cardId, reused: existing.some((a) => a.id === gated.actionId) };
  if (gated.kind === "deferred") return { kind: "deferred" };
  return { kind: "blocked" };
}
