import type { MetricKey } from "@north/core/tasks/types";
import { formatNumber, METRIC_LABELS } from "@/lib/labels";

export interface GoalProgressProps {
  readonly metricKey: string;
  readonly targetValue: number;
  readonly dueDate: string;
  readonly current: number | null;
  readonly measuredAt: string | null;
}

const metricLabel = (key: string): string => (key in METRIC_LABELS ? METRIC_LABELS[key as MetricKey] : key);

const clampPercent = (current: number | null, target: number): number => {
  if (current === null || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
};

/** Latest metric value against the target with a hairline progress bar. */
export function GoalProgress({ metricKey, targetValue, dueDate, current, measuredAt }: GoalProgressProps) {
  const percent = clampPercent(current, targetValue);
  return (
    <div className="border border-surface-border bg-surface p-5" data-testid="goal-progress">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xl">{metricLabel(metricKey)}</p>
        <p className="mono-label text-faint">due {dueDate}</p>
      </div>
      <p className="mt-3 font-display text-4xl">
        {current === null ? "—" : formatNumber(current)}
        <span className="text-muted"> / {formatNumber(targetValue)}</span>
      </p>
      <div
        className="hairline mt-4 h-2 w-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${percent}% of goal`}
      >
        <div className="h-full bg-fg transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      <p className="mono-label mt-2 text-faint">
        {percent}% · {measuredAt ? `measured ${new Date(measuredAt).toLocaleDateString("en-GB")}` : "no measurement yet"}
      </p>
    </div>
  );
}
