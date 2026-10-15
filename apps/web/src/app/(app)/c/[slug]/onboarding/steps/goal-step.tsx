import { OUTCOME_METRIC_KEYS } from "@north/core/tasks/types";
import { isoDateInDays, METRIC_LABELS } from "@/lib/labels";
import { saveGoalAction } from "../actions";
import { inputClass, WizardHeader } from "./wizard-header";

const DEFAULT_DUE_IN_DAYS = 60;
const DEFAULT_METRIC = "paying_customers";

/** Step 2: one measurable goal — metric, target and due date. */
export function GoalStep({ slug }: { slug: string }) {
  return (
    <>
      <WizardHeader step={2} label="Goal" title="One number to move">
        The Chief of Staff plans every week against this goal, and every task carries an expected delta on it.
      </WizardHeader>

      <form action={saveGoalAction} className="mt-8 flex flex-col gap-5">
        <input type="hidden" name="slug" value={slug} />
        <div className="flex flex-col gap-2">
          <label htmlFor="metricKey" className="mono-label">
            Metric
          </label>
          <select id="metricKey" name="metricKey" data-testid="goal-metric" defaultValue={DEFAULT_METRIC} required className={inputClass}>
            {OUTCOME_METRIC_KEYS.map((key) => (
              <option key={key} value={key}>
                {METRIC_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="targetValue" className="mono-label">
              Target
            </label>
            <input
              id="targetValue"
              name="targetValue"
              data-testid="goal-target"
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              required
              placeholder="10"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="dueDate" className="mono-label">
              Due date
            </label>
            <input
              id="dueDate"
              name="dueDate"
              data-testid="goal-due"
              type="date"
              required
              defaultValue={isoDateInDays(DEFAULT_DUE_IN_DAYS)}
              className={inputClass}
            />
          </div>
        </div>
        <button type="submit" className="retro-button retro-button-primary self-start" data-testid="goal-continue">
          Continue
        </button>
      </form>
    </>
  );
}
