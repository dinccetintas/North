import { currentThesis, listBudgets, listGoals } from "@north/db";
import { BUDGET_CATEGORIES } from "@north/core/authority/action";
import { createClient } from "@/lib/supabase/server";
import { BUDGET_LABELS, formatNumber, formatUsd, METRIC_LABELS } from "@/lib/labels";
import { approvePlanAction } from "../actions";
import { WizardHeader } from "./wizard-header";

/** What the agents do in the first 24 hours, in order. */
export const FIRST_DAY_PLAN = [
  "Market report: size, segments, pricing norms, the alternatives your customer uses today.",
  "Personas: three buyers with jobs, triggers and objections.",
  "Competitor map: who you are up against and where the gap is.",
  "PRD: the smallest product a customer would pay for.",
  "Business plan: model, channels, first 90 days.",
  "Investor deck: ten slides you can send tomorrow.",
  "Then the Chief of Staff writes the first weekly plan against your goal.",
] as const;

/** Step 4: everything on one page, then approve. */
export async function SummaryStep({ slug, companyId }: { slug: string; companyId: string }) {
  const db = await createClient();
  const [thesis, goals, budgets] = await Promise.all([currentThesis(db, companyId), listGoals(db, companyId), listBudgets(db, companyId)]);
  const goal = goals.find((g) => g.status === "active") ?? goals[0];
  const orderedBudgets = [...budgets].sort((a, b) => BUDGET_CATEGORIES.indexOf(a.category) - BUDGET_CATEGORIES.indexOf(b.category));

  return (
    <>
      <WizardHeader step={4} label="Summary" title="Ready to start">
        Check the brief below. Approving starts the research agent now; nothing leaves the building without a decision
        card.
      </WizardHeader>

      <section className="mt-8">
        <h2 className="mono-label text-faint">Thesis{thesis ? ` · v${thesis.version}` : ""}</h2>
        <p className="mt-2 border border-surface-border bg-surface p-5">{thesis?.text ?? "No thesis on record."}</p>
      </section>

      <section className="mt-8">
        <h2 className="mono-label text-faint">Your answers</h2>
        {thesis && thesis.clarifications.length > 0 ? (
          <dl className="mt-2 divide-y divide-surface-border border border-surface-border">
            {thesis.clarifications.map((c) => (
              <div key={c.id} className="p-4">
                <dt className="text-muted">{c.question}</dt>
                <dd className="mt-1">{c.answer.trim() || <span className="text-faint">—</span>}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-muted">No answers recorded.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mono-label text-faint">Goal</h2>
        <p className="mt-2 border border-surface-border bg-surface p-5" data-testid="summary-goal">
          {goal ? (
            <>
              <span className="font-display text-2xl">{formatNumber(goal.targetValue)}</span> {METRIC_LABELS[goal.metricKey]} by{" "}
              {goal.dueDate}
            </>
          ) : (
            "No goal set."
          )}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mono-label text-faint">Budget</h2>
        <ul className="mt-2 divide-y divide-surface-border border border-surface-border" data-testid="summary-budgets">
          {orderedBudgets.map((b) => (
            <li key={b.category} className="flex items-baseline justify-between gap-4 px-4 py-3">
              <span>{BUDGET_LABELS[b.category]}</span>
              <span className="mono-label text-muted">
                {formatUsd(b.totalLimitUsd)} total · {formatUsd(b.dailyLimitUsd)} / day
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mono-label text-faint">First 24 hours</h2>
        <ol className="mt-2 list-decimal space-y-2 border border-surface-border bg-surface p-5 pl-10">
          {FIRST_DAY_PLAN.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>

      <form action={approvePlanAction} className="mt-10">
        <input type="hidden" name="slug" value={slug} />
        <button type="submit" className="retro-button retro-button-primary" data-testid="approve-start">
          Approve and start
        </button>
      </form>
    </>
  );
}
