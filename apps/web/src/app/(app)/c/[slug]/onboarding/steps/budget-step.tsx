import { BUDGET_CATEGORIES } from "@north/core/authority/action";
import { BUDGET_DEFAULTS, BUDGET_LABELS } from "@/lib/labels";
import { saveBudgetAction } from "../actions";
import { inputClass, WizardHeader } from "./wizard-header";

/** Step 3: a total and a daily cap per category. Agents can never spend past these (K2 above the cap). */
export function BudgetStep({ slug }: { slug: string }) {
  return (
    <>
      <WizardHeader step={3} label="Budget" title="What the agents may spend">
        Caps in USD. Anything above a cap becomes a decision card for you; nothing is spent without a connected payment
        method anyway.
      </WizardHeader>

      <form action={saveBudgetAction} className="mt-8 flex flex-col gap-5">
        <input type="hidden" name="slug" value={slug} />
        <div className="hidden grid-cols-[1fr_8rem_8rem] gap-3 sm:grid">
          <span className="mono-label text-faint">Category</span>
          <span className="mono-label text-faint">Total</span>
          <span className="mono-label text-faint">Per day</span>
        </div>
        {BUDGET_CATEGORIES.map((category) => (
          <fieldset key={category} className="grid grid-cols-2 items-center gap-3 border-t border-surface-border pt-4 sm:grid-cols-[1fr_8rem_8rem] sm:border-0 sm:pt-0">
            <legend className="sr-only">{BUDGET_LABELS[category]}</legend>
            <span className="col-span-2 sm:col-span-1">{BUDGET_LABELS[category]}</span>
            <label className="flex flex-col gap-1">
              <span className="mono-label text-faint sm:sr-only">Total</span>
              <input
                name={`${category}-total`}
                data-testid={`budget-${category}-total`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                required
                defaultValue={BUDGET_DEFAULTS[category].total}
                aria-label={`${BUDGET_LABELS[category]} total`}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label text-faint sm:sr-only">Per day</span>
              <input
                name={`${category}-daily`}
                data-testid={`budget-${category}-daily`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                required
                defaultValue={BUDGET_DEFAULTS[category].daily}
                aria-label={`${BUDGET_LABELS[category]} per day`}
                className={inputClass}
              />
            </label>
          </fieldset>
        ))}
        <button type="submit" className="retro-button retro-button-primary self-start" data-testid="budget-continue">
          Continue
        </button>
      </form>
    </>
  );
}
