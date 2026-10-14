import { redirect } from "next/navigation";
import { getProfile, listActiveAutoRules, listCompanies } from "@north/db";
import { MAX_DAILY_QUOTA, MIN_DAILY_QUOTA } from "@north/core/decisions/types";
import { createClient, currentUser } from "@/lib/supabase/server";
import { AutoRulesList, type AutoRuleRow } from "@/components/auto-rules-list";
import { PushEnable } from "@/components/push-enable";
import { updateProfileAction } from "./actions";

export const metadata = { title: "Settings" };

type SearchParams = Promise<{ saved?: string; error?: string }>;

const inputClass = "hairline bg-bg px-3 py-3 outline-none focus:border-deep";
const QUOTAS = Array.from({ length: MAX_DAILY_QUOTA - MIN_DAILY_QUOTA + 1 }, (_, i) => MIN_DAILY_QUOTA + i);

/** IANA zones the runtime knows; the profile's zone is always included so the select never loses it. */
function timezoneOptions(current: string): readonly string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  return known.includes(current) ? known : [current, ...known];
}

/** Settings: decision quota, time zone, push notifications and the standing auto rules per company (DEC-2/3). */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, { saved, error }] = await Promise.all([currentUser(), searchParams]);
  if (!user) redirect("/login");
  const db = await createClient();
  const [profile, companies] = await Promise.all([getProfile(db, user.id), listCompanies(db)]);
  if (!profile) redirect("/login");

  const rules: AutoRuleRow[] = (
    await Promise.all(
      companies.map(async (company) =>
        (await listActiveAutoRules(db, company.id)).map((rule) => ({
          id: rule.id,
          companyId: company.id,
          companyName: company.name,
          kind: rule.kind,
          maxAmountUsd: rule.maxAmountUsd ?? null,
          category: rule.category ?? null,
        })),
      ),
    )
  ).flat();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="mono-label text-faint">{user.email}</p>
      <h1 className="mt-1 text-4xl">Settings</h1>

      {saved ? (
        <p className="mono-label mt-6 border border-success bg-success-bg px-3 py-3 text-success" role="status" data-testid="settings-saved">
          Saved.
        </p>
      ) : null}
      {error ? (
        <p className="mono-label mt-6 border border-error bg-error-bg px-3 py-3 text-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="mono-label text-faint">Decisions</h2>
        <form action={updateProfileAction} className="mt-3 flex flex-col gap-5 border border-surface-border bg-surface p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="dailyDecisionQuota" className="mono-label">
                Cards per day
              </label>
              <select id="dailyDecisionQuota" name="dailyDecisionQuota" defaultValue={profile.dailyDecisionQuota} className={inputClass} data-testid="settings-quota">
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
              <select id="timezone" name="timezone" defaultValue={profile.timezone} className={inputClass} data-testid="settings-timezone">
                {timezoneOptions(profile.timezone).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="mono-label text-faint">The morning brief follows this clock. The daily card quota resets at midnight UTC for now.</p>
            </div>
          </div>
          <div>
            <button type="submit" className="retro-button retro-button-primary" data-testid="settings-save">
              Save
            </button>
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Notifications</h2>
        <div className="mt-3 border border-surface-border bg-surface p-5">
          <p className="text-muted">A new card reaches you by email at {profile.email}. Add this browser to get a push notification too.</p>
          <div className="mt-4">
            <PushEnable publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Standing rules</h2>
        <div className="mt-3">
          <AutoRulesList rules={rules} />
        </div>
      </section>
    </main>
  );
}
