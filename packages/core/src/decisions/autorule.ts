import type { AnsweredCard } from "./types.js";
import type { ActionKind, BudgetCategory } from "../authority/action.js";

export const AUTO_RULE_REPEATS = 3;

export interface AutoRuleSuggestion {
  readonly kind: ActionKind;
  readonly optionId: string;
  /** Suggested ceiling: the max cost seen in the repeated answers. */
  readonly maxAmountUsd: number;
  readonly category?: BudgetCategory;
  readonly basedOn: readonly AnsweredCard[];
}

/**
 * DEC-3: after the same kind of decision is answered the same way three times in
 * a row, suggest a standing rule. The rule is only created when the user accepts.
 */
export function suggestAutoRule(history: readonly AnsweredCard[]): AutoRuleSuggestion | null {
  if (history.length < AUTO_RULE_REPEATS) return null;
  const recent = [...history]
    .sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt))
    .slice(0, AUTO_RULE_REPEATS);
  const first = recent[0];
  if (!first) return null;
  const consistent = recent.every(
    (c) => c.actionKind === first.actionKind && c.answeredOptionId === first.answeredOptionId,
  );
  if (!consistent || first.answeredOptionId === "decline") return null;

  const category = first.mergeKey.split(":")[1];
  return Object.freeze({
    kind: first.actionKind,
    optionId: first.answeredOptionId,
    maxAmountUsd: Math.max(...recent.map((c) => c.costUsd)),
    ...(category && category !== "none" ? { category: category as BudgetCategory } : {}),
    basedOn: Object.freeze(recent),
  });
}
