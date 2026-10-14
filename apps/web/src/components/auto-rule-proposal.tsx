"use client";

import { useState, useTransition } from "react";
import { acceptAutoRuleAction } from "@/app/(app)/c/[slug]/decisions/actions";
import type { ActionKind, BudgetCategory } from "@north/core/authority/action";
import { BUDGET_LABELS, formatUsd } from "@/lib/labels";

export interface AutoRuleProposalProps {
  readonly slug: string;
  readonly cardId: string;
  readonly kind: ActionKind;
  readonly maxAmountUsd: number;
  readonly category: BudgetCategory | null;
  readonly repeats: number;
}

/** DEC-3: after the same answer three times, offer a standing rule. Nothing is created until the CEO accepts. */
export function AutoRuleProposal({ slug, cardId, kind, maxAmountUsd, category, repeats }: AutoRuleProposalProps) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"offered" | "accepted" | "error">("offered");
  const [error, setError] = useState<string | null>(null);

  const accept = () =>
    startTransition(async () => {
      const result = await acceptAutoRuleAction({ slug, cardId, kind, maxAmountUsd, ...(category ? { category } : {}) });
      if (result.ok) setState("accepted");
      else {
        setState("error");
        setError(result.error);
      }
    });

  const scope = `${kind}${category ? ` (${BUDGET_LABELS[category].toLowerCase()})` : ""}`;

  return (
    <div className="border border-fg bg-surface p-5" data-testid="auto-rule-proposal">
      <p>
        You approved <span className="mono-label">{scope}</span> {repeats} times in a row.
        {maxAmountUsd > 0 ? ` Auto-approve it under ${formatUsd(maxAmountUsd)} from now on?` : " Auto-approve it from now on?"}
      </p>
      <p className="mono-label mt-2 text-faint">You can switch the rule off any time in Settings.</p>
      {state === "accepted" ? (
        <p className="mono-label mt-4 text-success" data-testid="auto-rule-accepted">
          Rule saved. This decision will not be asked again.
        </p>
      ) : (
        <button type="button" onClick={accept} disabled={pending} className="retro-button retro-button-primary mt-4" data-testid="auto-rule-accept">
          {pending ? "…" : "Don't ask again"}
        </button>
      )}
      {error ? (
        <p className="mono-label mt-3 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
