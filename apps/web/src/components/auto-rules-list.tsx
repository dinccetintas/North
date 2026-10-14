"use client";

import { useState, useTransition } from "react";
import { deactivateAutoRuleAction } from "@/app/(app)/settings/actions";
import { formatUsd } from "@/lib/labels";

export interface AutoRuleRow {
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly kind: string;
  readonly maxAmountUsd: number | null;
  readonly category: string | null;
}

/** Active "don't ask again" rules across the user's companies, each with a switch-off (DEC-3). */
export function AutoRulesList({ rules }: { rules: readonly AutoRuleRow[] }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const visible = rules.filter((r) => !removed.has(r.id));

  const deactivate = (rule: AutoRuleRow) =>
    startTransition(async () => {
      const result = await deactivateAutoRuleAction({ companyId: rule.companyId, ruleId: rule.id });
      if (result.ok) setRemoved(new Set([...removed, rule.id]));
      else setError(result.error);
    });

  if (visible.length === 0) {
    return (
      <p className="border border-surface-border bg-surface p-5 text-muted" data-testid="auto-rules-empty">
        No standing rules. After you answer the same decision three times the same way, the card offers one.
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-surface-border border border-surface-border" data-testid="auto-rules">
        {visible.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3" data-testid="auto-rule" data-rule-id={rule.id}>
            <span className="flex flex-col">
              <span className="mono-label">{rule.kind}</span>
              <span className="mono-label text-faint">
                {rule.companyName}
                {rule.category ? ` · ${rule.category}` : ""}
                {rule.maxAmountUsd !== null ? ` · under ${formatUsd(rule.maxAmountUsd)}` : ""}
              </span>
            </span>
            <button type="button" onClick={() => deactivate(rule)} disabled={pending} className="retro-button" data-testid="auto-rule-deactivate">
              Switch off
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="mono-label mt-3 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
