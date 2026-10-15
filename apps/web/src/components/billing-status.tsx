import type { BillingSummary } from "@/lib/billing-view";
import { startPortalAction } from "@/app/(app)/settings/billing/actions";
import { SubmitButton } from "@/components/submit-button";

const STATUS_CLASS: Readonly<Record<BillingSummary["status"], string>> = Object.freeze({
  trialing: "text-deep",
  active: "text-success",
  canceled: "text-warning",
  past_due: "text-error",
  ended: "text-error",
});

/** RET-1: "Your agents are paused. Subscribe to resume; your data is kept until <date>." with the date marked. */
function EndedNotice({ notice, retentionUntil }: { notice: string; retentionUntil: string | null }) {
  const at = retentionUntil ? notice.indexOf(retentionUntil) : -1;
  return (
    <p className="mono-label mt-4 border border-error bg-error-bg px-3 py-3 text-error" data-testid="billing-ended">
      {at < 0 || !retentionUntil ? (
        notice
      ) : (
        <>
          {notice.slice(0, at)}
          <span data-testid="billing-retention-until">{retentionUntil}</span>
          {notice.slice(at + retentionUntil.length)}
        </>
      )}
    </p>
  );
}

/** BIL-1: the plan, its status and period, the companies it allows, and the way to Stripe's portal. Text only; the webhook alone changes it. */
export function BillingStatus({ summary }: { summary: BillingSummary }) {
  return (
    <section className="mt-8 border border-surface-border bg-surface p-5" data-testid="billing-status">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="font-display text-4xl" data-testid="billing-plan" data-plan-id={summary.planId} data-status={summary.status}>
          {summary.planName}
        </p>
        <span className={`mono-label ${STATUS_CLASS[summary.status]}`} data-testid="billing-status-label">
          {summary.statusLabel}
        </span>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="mono-label text-faint">Period</dt>
          <dd className="mt-0.5" data-testid="billing-period">
            {summary.period}
          </dd>
        </div>
        <div>
          <dt className="mono-label text-faint">Companies</dt>
          <dd className="mt-0.5" data-testid="billing-companies">
            {summary.companies}
          </dd>
        </div>
      </dl>
      {summary.endedNotice ? <EndedNotice notice={summary.endedNotice} retentionUntil={summary.retentionUntil} /> : null}
      <form action={startPortalAction} className="mt-5">
        <SubmitButton testId="billing-portal">Manage billing</SubmitButton>
        <span className="mono-label ml-3 text-faint">Card, invoices and cancellation live in Stripe.</span>
      </form>
    </section>
  );
}
