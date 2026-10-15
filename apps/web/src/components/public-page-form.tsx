import { OUTCOME_METRIC_KEYS } from "@north/core/tasks/types";
import { PUBLIC_BLURB_MAX, PUBLIC_HEADLINE_MAX, PUBLIC_METRICS_MAX, type PublicPage } from "@north/core/public-page";
import { metricLabel } from "@/lib/labels";
import { savePublicPageAction } from "@/app/(app)/c/[slug]/public/actions";
import { SubmitButton } from "@/components/submit-button";

const inputClass = "hairline bg-bg px-3 py-3 outline-none focus:border-deep";

function Check({ name, label, checked, testId, hint }: { name: string; label: string; checked: boolean; testId: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={checked} data-testid={testId} className="mt-1.5" />
      <span>
        {label}
        {hint ? <span className="mono-label block text-faint">{hint}</span> : null}
      </span>
    </label>
  );
}

export interface PublicPageFormProps {
  readonly slug: string;
  readonly enabled: boolean;
  readonly page: PublicPage | null;
}

/** PUB-1: what strangers may see, chosen by the owner; off by default and `noindex` until "listed". */
export function PublicPageForm({ slug, enabled, page }: PublicPageFormProps) {
  const chosen = new Set(page?.metricKeys ?? []);
  return (
    <form action={savePublicPageAction.bind(null, slug)} className="mt-6 flex flex-col gap-5 border border-surface-border bg-surface p-5" data-testid="public-form">
      <Check name="enabled" label="Public page on" checked={enabled} testId="public-enabled" hint={`Anyone with the link can read /p/${slug}.`} />
      <div className="flex flex-col gap-2">
        <label htmlFor="headline" className="mono-label">
          Headline
        </label>
        <input id="headline" name="headline" maxLength={PUBLIC_HEADLINE_MAX} defaultValue={page?.headline ?? ""} className={inputClass} data-testid="public-headline-input" />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="blurb" className="mono-label">
          Blurb
        </label>
        <textarea id="blurb" name="blurb" rows={4} maxLength={PUBLIC_BLURB_MAX} defaultValue={page?.blurb ?? ""} className={inputClass} data-testid="public-blurb-input" />
      </div>
      <Check name="showGoal" label="Show the goal and its progress" checked={page?.showGoal ?? false} testId="public-show-goal" />
      <fieldset className="flex flex-col gap-2">
        <legend className="mono-label">Metrics (up to {PUBLIC_METRICS_MAX})</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OUTCOME_METRIC_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" name="metricKeys" value={key} defaultChecked={chosen.has(key)} data-testid={`public-metric-${key}`} />
              <span>{metricLabel(key)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Check name="showSiteLink" label="Link to the live site (https only)" checked={page?.showSiteLink ?? false} testId="public-show-site" />
      <Check name="listed" label="Listed: search engines may index the page" checked={page?.listed ?? false} testId="public-listed" hint="Off: the page carries noindex." />
      <div>
        <SubmitButton className="retro-button retro-button-primary" testId="public-save">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}
