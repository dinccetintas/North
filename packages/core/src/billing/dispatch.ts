import type { PausedReason } from "../companies";
import { canDispatch } from "./credits";
import { isActive, type Entitlement } from "./entitlements";

/**
 * BIL-1 (ADR 0014): every agent run asks first. The worker's
 * `dispatchAllowed(deps, companyId)` reads the rows and feeds this pure
 * decision; a refusal is a `blocked` outcome with its reason, never a thrown
 * error, and the task stays `queued`.
 */
export const DISPATCH_BLOCK_REASONS = ["kill_switch", "subscription_ended", "retention", "credits_exhausted"] as const;
export type DispatchBlockReason = (typeof DISPATCH_BLOCK_REASONS)[number];

export interface DispatchInput {
  readonly killSwitchActive: boolean;
  /** Why the switch is on, when the row says; billing's pause reads as its own reason. */
  readonly pausedReason?: PausedReason | null;
  /** The owner's entitlement; none at all blocks like an ended one. */
  readonly entitlement: Pick<Entitlement, "status" | "purgeDue" | "retentionUntil"> | null;
  readonly balance: number;
  /** For the retention check; without it only `purgeDue` says the data is past retention. */
  readonly now?: Date;
}

export type DispatchDecision = { readonly ok: true } | { readonly ok: false; readonly reason: DispatchBlockReason };

const blocked = (reason: DispatchBlockReason): DispatchDecision => Object.freeze({ ok: false, reason });

function switchReason(pausedReason: PausedReason | null | undefined): DispatchBlockReason {
  if (pausedReason === "retention") return "retention";
  if (pausedReason === "subscription_ended") return "subscription_ended";
  return "kill_switch";
}

function pastRetention(entitlement: NonNullable<DispatchInput["entitlement"]>, now: Date | undefined): boolean {
  if (entitlement.purgeDue) return true;
  return entitlement.retentionUntil !== null && now !== undefined && Date.parse(entitlement.retentionUntil) <= now.getTime();
}

/** Kill switch first, then the entitlement, then credits: the order the brief and the task list explain. */
export function dispatchDecision(input: DispatchInput): DispatchDecision {
  if (input.killSwitchActive) return blocked(switchReason(input.pausedReason));
  if (input.entitlement === null) return blocked("subscription_ended");
  if (!isActive(input.entitlement)) return blocked(pastRetention(input.entitlement, input.now) ? "retention" : "subscription_ended");
  if (!canDispatch(input.balance)) return blocked("credits_exhausted");
  return Object.freeze({ ok: true });
}
