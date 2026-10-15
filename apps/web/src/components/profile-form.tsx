import { MAX_DAILY_QUOTA, MIN_DAILY_QUOTA } from "@north/core/decisions/types";
import { updateProfileAction } from "@/app/(app)/settings/actions";

const inputClass = "hairline bg-bg px-3 py-3 outline-none focus:border-deep";
const QUOTAS = Array.from({ length: MAX_DAILY_QUOTA - MIN_DAILY_QUOTA + 1 }, (_, i) => MIN_DAILY_QUOTA + i);
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** IANA zones the runtime knows; the profile's zone is always included so the select never loses it. */
function timezoneOptions(current: string): readonly string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  return known.includes(current) ? known : [current, ...known];
}

export interface ProfileFormProps {
  readonly dailyDecisionQuota: number;
  readonly timezone: string;
  /** BRF-1 (M6): the owner-local hour the brief arrives, 0..23. */
  readonly briefHour: number;
}

/** Settings: cards per day (DEC-3), the time zone and the brief hour, validated by the repository before any write. */
export function ProfileForm({ dailyDecisionQuota, timezone, briefHour }: ProfileFormProps) {
  return (
    <form action={updateProfileAction} className="mt-3 flex flex-col gap-5 border border-surface-border bg-surface p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="dailyDecisionQuota" className="mono-label">
            Cards per day
          </label>
          <select id="dailyDecisionQuota" name="dailyDecisionQuota" defaultValue={dailyDecisionQuota} className={inputClass} data-testid="settings-quota">
            {QUOTAS.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
          <p className="mono-label text-faint">Agents never open more than this many cards a day. Extra decisions wait for tomorrow.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="timezone" className="mono-label">
            Time zone
          </label>
          <select id="timezone" name="timezone" defaultValue={timezone} className={inputClass} data-testid="settings-timezone">
            {timezoneOptions(timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="mono-label text-faint">The morning brief and the daily card quota follow this clock.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="briefHour" className="mono-label">
            Brief hour
          </label>
          <select id="briefHour" name="briefHour" defaultValue={briefHour} className={inputClass} data-testid="settings-brief-hour">
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {`${String(h).padStart(2, "0")}:00`}
              </option>
            ))}
          </select>
          <p className="mono-label text-faint">Your brief arrives at this hour in your time zone.</p>
        </div>
      </div>
      <div>
        <button type="submit" className="retro-button retro-button-primary" data-testid="settings-save">
          Save
        </button>
      </div>
    </form>
  );
}
