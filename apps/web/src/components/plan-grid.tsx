import type { PlanCardView } from "@/lib/billing-view";
import { startCheckoutAction, startPortalAction } from "@/app/(app)/settings/billing/actions";
import { SubmitButton } from "@/components/submit-button";

function PlanAction({ plan }: { plan: PlanCardView }) {
  if (plan.action === "current") {
    return (
      <span className="mono-label border border-fg px-3 py-1.5" data-testid="plan-choose" data-plan-id={plan.id} data-action="current" aria-disabled="true">
        {plan.actionLabel}
      </span>
    );
  }
  const action = plan.action === "portal" ? startPortalAction : startCheckoutAction.bind(null, plan.id);
  return (
    <form action={action}>
      <SubmitButton className={plan.action === "checkout" ? "retro-button retro-button-primary" : "retro-button"} testId="plan-choose" data-plan-id={plan.id} data-action={plan.action}>
        {plan.actionLabel}
      </SubmitButton>
    </form>
  );
}

/** BIL-1: Solo, Pro and Scale from `plans.ts`; a subscriber switches in Stripe's portal, never through a second checkout. */
export function PlanGrid({ plans }: { plans: readonly PlanCardView[] }) {
  return (
    <ul className="grid gap-px border border-surface-border bg-surface-border sm:grid-cols-3" data-testid="plan-grid">
      {plans.map((plan) => (
        <li key={plan.id} className={`flex flex-col gap-3 bg-bg p-5 ${plan.current ? "outline outline-1 -outline-offset-1 outline-fg" : ""}`} data-testid="plan-card" data-plan-id={plan.id} data-current={plan.current ? "true" : "false"}>
          <p className="font-display text-3xl">{plan.name}</p>
          <p className="mono-label text-muted">{plan.priceLabel}</p>
          <ul className="flex flex-col gap-1 text-muted">
            <li>{plan.companiesLabel}</li>
            <li>{plan.creditsLabel}</li>
          </ul>
          <div className="mt-auto pt-2">
            <PlanAction plan={plan} />
          </div>
        </li>
      ))}
    </ul>
  );
}
