import type { UsageView } from "@/lib/usage-view";

/**
 * BIL-2, the spec's cost NFR: this month's inference and sandbox cost against
 * the plan price, with the 40 % line. Above it the bar turns to the accent and
 * the alert copy appears (the worker also sends one notification per period).
 */
export function UsagePanel({ usage, period }: { usage: UsageView; period: string }) {
  return (
    <section className="mt-10" data-testid="usage-panel" data-period={period}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint">Usage this month</h2>
        <span className="mono-label text-faint">
          {period} · {usage.runs} {usage.runs === 1 ? "run" : "runs"}
        </span>
      </div>
      <div className="mt-3 border border-surface-border bg-surface p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="mono-label text-faint">Inference</dt>
            <dd className="mt-0.5 font-display text-2xl" data-testid="usage-inference">
              {usage.inference}
            </dd>
          </div>
          <div>
            <dt className="mono-label text-faint">Sandbox</dt>
            <dd className="mt-0.5 font-display text-2xl" data-testid="usage-sandbox">
              {usage.sandbox}
            </dd>
          </div>
          <div>
            <dt className="mono-label text-faint">Total</dt>
            <dd className="mt-0.5 font-display text-2xl" data-testid="usage-total">
              {usage.total}
            </dd>
          </div>
          <div>
            <dt className="mono-label text-faint">Plan price</dt>
            <dd className="mt-0.5 font-display text-2xl" data-testid="usage-price">
              {usage.price}
            </dd>
          </div>
        </dl>
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <span className={`mono-label ${usage.alert ? "text-deep" : "text-muted"}`} data-testid="usage-ratio" data-ratio={usage.ratio} {...(usage.alert ? { "data-alert": "true" } : {})}>
              {usage.noPrice ? "No plan price during the trial" : `${usage.ratioLabel} of the plan price`}
            </span>
            <span className="mono-label text-faint">line at {usage.markPercent} %</span>
          </div>
          <div className="hairline relative mt-2 h-2 w-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage.barPercent} aria-label="Cost as a share of the plan price">
            <div className={`h-full ${usage.alert ? "bg-deep" : "bg-fg"}`} style={{ width: `${usage.barPercent}%` }} />
            <span aria-hidden className="absolute -top-1 h-4 w-px bg-deep" style={{ left: `${usage.markPercent}%` }} />
          </div>
        </div>
        {usage.alertCopy ? (
          <p className="mono-label mt-4 border border-deep px-3 py-2 text-deep" data-testid="usage-alert">
            {usage.alertCopy}
          </p>
        ) : null}
      </div>
    </section>
  );
}
