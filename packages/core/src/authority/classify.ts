import type { ActionSpec } from "./action.js";
import { ACTION_PROFILES } from "./action.js";
import type { Tier } from "../tiers.js";
import { maxTier } from "../tiers.js";

/** Any single spend above this amount is K3 (spec: "$500 üstü tek harcama"). */
export const K3_SINGLE_SPEND_USD = 500;

export type ClassifyReason =
  | "no_external_effect"
  | "reversible_no_spend"
  | "spends_money"
  | "public_statement"
  | "new_contact"
  | "goes_live"
  | "irreversible"
  | "legally_binding"
  | "single_spend_over_limit"
  | "agent_raised";

export interface Classification {
  readonly tier: Tier;
  readonly reasons: readonly ClassifyReason[];
}

/**
 * Pure tier classification from the spec's rule table.
 *
 * K3: irreversible, legally binding, or a single spend over the limit.
 * K2: spends money, says something new in public, contacts a new person, or goes live.
 * K1: external, reversible, no spend.
 * K0: no external effect.
 * An agent-requested tier can only raise the result.
 */
export function classify(spec: ActionSpec): Classification {
  const profile = ACTION_PROFILES[spec.kind];
  const reasons: ClassifyReason[] = [];
  let tier: Tier = "K0";

  if (!profile.externalEffect) {
    reasons.push("no_external_effect");
  } else if (profile.reversible && !profile.spendsMoney) {
    tier = "K1";
    reasons.push("reversible_no_spend");
  }

  if (profile.spendsMoney) {
    tier = maxTier(tier, "K2");
    reasons.push("spends_money");
  }
  if (profile.publicStatement) {
    tier = maxTier(tier, "K2");
    reasons.push("public_statement");
  }
  if (profile.newContact) {
    tier = maxTier(tier, "K2");
    reasons.push("new_contact");
  }
  if (profile.goesLive) {
    tier = maxTier(tier, "K2");
    reasons.push("goes_live");
  }
  // External, irreversible, no spend, no public statement (e.g. a reply in an
  // existing thread) is at least K1: it touches the world but needs no card.
  if (profile.externalEffect && tier === "K0") {
    tier = "K1";
  }

  if (profile.irreversible) {
    tier = "K3";
    reasons.push("irreversible");
  }
  if (profile.legallyBinding) {
    tier = "K3";
    reasons.push("legally_binding");
  }
  if ((spec.amountUsd ?? 0) > K3_SINGLE_SPEND_USD) {
    tier = "K3";
    reasons.push("single_spend_over_limit");
  }

  if (spec.requestedTier && maxTier(tier, spec.requestedTier) !== tier) {
    tier = spec.requestedTier;
    reasons.push("agent_raised");
  }

  return Object.freeze({ tier, reasons: Object.freeze(reasons) });
}
