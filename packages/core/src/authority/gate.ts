import type { ActionSpec } from "./action";
import { classify, type ClassifyReason } from "./classify";
import type { Tier } from "../tiers";
import { wouldExceedBudget, type BudgetState } from "../budget/guard";
import type { CardDraft } from "../decisions/types";

export interface AutoRule {
  readonly id: string;
  readonly kind: ActionSpec["kind"];
  readonly maxAmountUsd?: number;
  readonly category?: ActionSpec["category"];
  readonly active: boolean;
}

export interface PolicyContext {
  readonly killSwitchActive: boolean;
  readonly budgets: readonly BudgetState[];
  readonly autoRules: readonly AutoRule[];
  /** Default due time for cards opened by this gate, as an ISO timestamp. */
  readonly cardDueAt: string;
}

export type GateReason = ClassifyReason | "budget_cap" | "kill_switch" | "auto_rule";

interface Decided {
  readonly tier: Tier;
  readonly reasons: readonly GateReason[];
}

export type GateDecision =
  | (Decided & { readonly kind: "run"; readonly autoRuleId?: string })
  | (Decided & { readonly kind: "notify" })
  | (Decided & { readonly kind: "card"; readonly card: CardDraft })
  | (Decided & { readonly kind: "block" });

function matchingAutoRule(spec: ActionSpec, rules: readonly AutoRule[]): AutoRule | undefined {
  return rules.find((rule) => {
    if (!rule.active || rule.kind !== spec.kind) return false;
    if (rule.category && rule.category !== spec.category) return false;
    if (rule.maxAmountUsd !== undefined && (spec.amountUsd ?? 0) > rule.maxAmountUsd) return false;
    return true;
  });
}

function budgetFor(spec: ActionSpec, budgets: readonly BudgetState[]): BudgetState | undefined {
  return budgets.find((b) => b.category === (spec.category ?? "other"));
}

function cardFor(spec: ActionSpec, tier: Tier, reasons: readonly GateReason[], dueAt: string): CardDraft {
  const isK3 = tier === "K3";
  return Object.freeze({
    companyId: spec.companyId,
    question: `Approve: ${spec.description}?`,
    options: [
      { id: "approve", label: "Approve" },
      { id: "decline", label: "Decline" },
    ],
    recommendedOptionId: "approve",
    rationale: `Tier ${tier} (${reasons.join(", ")}). Requested by ${spec.agentRole}.`,
    expectedImpact: null,
    costUsd: spec.amountUsd ?? 0,
    dueAt,
    // K3 never has a default; K2 defaults to the safe choice (decline).
    defaultOptionId: isK3 ? null : "decline",
    tier,
    actionKind: spec.kind,
    mergeKey: `${spec.kind}:${spec.category ?? "none"}`,
  });
}

const frozen = (reasons: readonly GateReason[]): readonly GateReason[] => Object.freeze([...reasons]);

/**
 * The single chokepoint for external actions (ADR 0001, DEC-1).
 *
 * Order of checks: kill switch → classify → budget cap → auto rule → tier routing.
 */
export function gate(spec: ActionSpec, ctx: PolicyContext): GateDecision {
  const { tier: baseTier, reasons: baseReasons } = classify(spec);

  if (ctx.killSwitchActive) {
    return Object.freeze({ kind: "block", tier: baseTier, reasons: frozen([...baseReasons, "kill_switch"]) });
  }

  let tier = baseTier;
  const reasons: GateReason[] = [...baseReasons];

  if (spec.amountUsd !== undefined && spec.amountUsd > 0) {
    const budget = budgetFor(spec, ctx.budgets);
    if (!budget || wouldExceedBudget(budget, spec.amountUsd)) {
      tier = tier === "K3" ? "K3" : "K2";
      reasons.push("budget_cap");
    }
  }

  if (tier === "K3") {
    return Object.freeze({ kind: "card", tier, reasons: frozen(reasons), card: cardFor(spec, tier, reasons, ctx.cardDueAt) });
  }

  if (tier === "K2") {
    const rule = reasons.includes("budget_cap") ? undefined : matchingAutoRule(spec, ctx.autoRules);
    if (rule) {
      return Object.freeze({ kind: "run", tier, reasons: frozen([...reasons, "auto_rule"]), autoRuleId: rule.id });
    }
    return Object.freeze({ kind: "card", tier, reasons: frozen(reasons), card: cardFor(spec, tier, reasons, ctx.cardDueAt) });
  }

  if (tier === "K1") {
    return Object.freeze({ kind: "notify", tier, reasons: frozen(reasons) });
  }

  return Object.freeze({ kind: "run", tier, reasons: frozen(reasons) });
}
