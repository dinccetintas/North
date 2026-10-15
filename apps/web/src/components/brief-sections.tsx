import type { ReactNode } from "react";
import { scoreLabel, signedDelta, type BriefView } from "@/lib/brief-view";
import { BUDGET_LABELS, formatUsd, metricLabel, signalSourceLabel, signalStatusClass } from "@/lib/labels";
import type { BudgetCategory } from "@north/core/authority/action";

const categoryLabel = (category: string): string => (category in BUDGET_LABELS ? BUDGET_LABELS[category as BudgetCategory] : category);

/** One section of the brief: a mono heading and its rows; always rendered so the panel reads the same every morning. */
export function BriefSection({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="border-t border-surface-border pt-3" data-testid={testId}>
      <h3 className="mono-label text-faint">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

export const Nothing = ({ text = "Nothing." }: { text?: string }) => <p className="text-muted">{text}</p>;

export function BriefYesterday({ brief }: { brief: BriefView }) {
  return (
    <BriefSection title="Yesterday" testId="brief-yesterday">
      <ul className="flex flex-col gap-0.5">
        {brief.yesterday.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </BriefSection>
  );
}

export function BriefMetrics({ brief }: { brief: BriefView }) {
  return (
    <BriefSection title="Metrics" testId="brief-metrics">
      {brief.metrics.length === 0 ? (
        <Nothing text="No metrics yet." />
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {brief.metrics.map((m) => (
            <div key={m.key} data-testid="brief-metric" data-key={m.key}>
              <dt className="mono-label text-faint">{metricLabel(m.key)}</dt>
              <dd className="mt-0.5 flex items-baseline gap-2">
                <span className="font-display text-xl leading-tight" data-testid="brief-metric-value">
                  {m.value}
                </span>
                {m.delta !== null ? (
                  <span className={`mono-label ${m.delta > 0 ? "text-success" : m.delta < 0 ? "text-error" : "text-faint"}`} data-testid="brief-metric-delta">
                    {signedDelta(m.delta)}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {brief.goal ? (
        <p className="mono-label mt-2 text-muted">
          Goal {metricLabel(brief.goal.metricKey)}: {brief.goal.current} of {brief.goal.target} by {brief.goal.dueDate}
        </p>
      ) : null}
    </BriefSection>
  );
}

export function BriefSpend({ brief }: { brief: BriefView }) {
  return (
    <BriefSection title="Spend" testId="brief-spend">
      {brief.spend.length === 0 ? (
        <Nothing text="No budgets set." />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {brief.spend.map((s) => (
            <li key={s.category} className="flex flex-wrap items-baseline gap-x-3" data-testid="brief-spend-row" data-category={s.category}>
              <span>{categoryLabel(s.category)}</span>
              <span className="mono-label text-muted">
                {formatUsd(s.spentTodayUsd)} of {formatUsd(s.dailyCapUsd)} today · {formatUsd(s.spentTotalUsd)} of {formatUsd(s.totalCapUsd)} total
              </span>
            </li>
          ))}
        </ul>
      )}
    </BriefSection>
  );
}

export function BriefSignals({ brief }: { brief: BriefView }) {
  return (
    <BriefSection title="Signals" testId="brief-signals">
      {brief.signals.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="flex flex-col gap-1">
          {brief.signals.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" data-testid="brief-signal" data-signal-id={s.id} data-status={s.status}>
              <span className="mono-label text-muted">
                {signalSourceLabel(s.source)} {scoreLabel(s.score)}
              </span>
              <span className={`mono-label ${signalStatusClass(s.status)}`}>{s.statusWord}</span>
              <span>{s.title}</span>
            </li>
          ))}
        </ul>
      )}
    </BriefSection>
  );
}

export function BriefEscalations({ brief }: { brief: BriefView }) {
  return (
    <BriefSection title="Escalations" testId="brief-escalations">
      {brief.escalations.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {brief.escalations.map((title) => (
            <li key={title} className="text-warning">
              {title}
            </li>
          ))}
        </ul>
      )}
    </BriefSection>
  );
}
