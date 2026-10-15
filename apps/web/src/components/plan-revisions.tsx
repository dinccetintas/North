import { taskTypeLabel } from "@/lib/labels";

export interface PlanRevisionRow {
  readonly taskType: string;
  readonly change: string;
  readonly reason: string;
}

const CHANGE_CLASS: Readonly<Record<string, string>> = Object.freeze({
  dropped: "text-error",
  fewer: "text-warning",
  more: "text-success",
  added: "text-success",
});

/**
 * PLN-2: for every task type the Chief of Staff cut (or grew) against the
 * previous plan, the reason, in the ledger's numbers. Hidden when the plan
 * has no revisions (the first plan of a company).
 */
export function PlanRevisions({ revisions }: { revisions: readonly PlanRevisionRow[] }) {
  if (revisions.length === 0) return null;
  return (
    <ul className="mt-3 divide-y divide-surface-border border border-surface-border" data-testid="plan-revisions" aria-label="Plan revisions">
      {revisions.map((r) => (
        <li key={`${r.taskType}:${r.change}`} className="bg-surface px-4 py-3" data-testid="plan-revision" data-task-type={r.taskType} data-change={r.change}>
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className={`mono-label ${CHANGE_CLASS[r.change] ?? "text-faint"}`}>{r.change}</span>
            <span>{taskTypeLabel(r.taskType)}</span>
          </p>
          <p className="mt-1 text-muted" data-testid="plan-revision-reason">
            {r.reason}
          </p>
        </li>
      ))}
    </ul>
  );
}
