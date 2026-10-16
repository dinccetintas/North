import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveAutoRules } from "@north/db";
import { BRIEF_HOUR } from "@north/core/time";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ownerCompanies, ownerProfile } from "@/lib/account";
import { loadPlanSnapshot } from "@/lib/billing-data";
import { loadCostRows } from "@/lib/cost-data";
import { COST_WINDOW_DAYS } from "@/lib/cost-view";
import { ENTITLEMENT_STATUS_LABELS, SUBSCRIPTION_PLAN_LABELS } from "@/lib/labels";
import { AutoRulesList, type AutoRuleRow } from "@/components/auto-rules-list";
import { CostDashboard } from "@/components/cost-dashboard";
import { ProfileForm } from "@/components/profile-form";
import { PushEnable } from "@/components/push-enable";
import { errorText } from "@/lib/page-errors";

export const metadata = { title: "Settings" };

type SearchParams = Promise<{ saved?: string; error?: string }>;

/** Settings: plan and credits (BIL-1/2), decision quota, time zone and brief hour, push, connections, export, the standing auto rules and the usage per company (DEC-2/3, BRF-1, OBS-1). */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, { saved, error: errorCode }] = await Promise.all([currentUser(), searchParams]);
  const error = errorText("settings", errorCode);
  if (!user) redirect("/login");
  const db = await createClient();
  const [profile, companies, plan] = await Promise.all([ownerProfile(user.id), ownerCompanies(), loadPlanSnapshot(db, user.id)]);
  if (!profile) redirect("/login");
  const costs = await loadCostRows(db, companies, profile.timezone);

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
        <h2 className="mono-label text-faint">Plan and credits</h2>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4 border border-surface-border bg-surface p-5" data-testid="settings-plan">
          <p>
            <span className="font-display text-2xl" data-testid="settings-plan-name">
              {plan.entitlement ? SUBSCRIPTION_PLAN_LABELS[plan.entitlement.planId] : "No plan"}
            </span>
            {plan.entitlement ? <span className="mono-label ml-3 text-faint">{ENTITLEMENT_STATUS_LABELS[plan.entitlement.status]}</span> : null}
            <span className="mono-label ml-3 text-muted">
              <span data-testid="settings-credits">{plan.balance}</span> credits
            </span>
          </p>
          <Link href="/settings/billing" className="retro-button inline-block" data-testid="settings-billing">
            Plan and credits
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Decisions and brief</h2>
        <ProfileForm dailyDecisionQuota={profile.dailyDecisionQuota} timezone={profile.timezone} briefHour={profile.briefHour ?? BRIEF_HOUR} />
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
        <h2 className="mono-label text-faint">Connections</h2>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4 border border-surface-border bg-surface p-5">
          <p className="text-muted">GitHub and Vercel accounts the engineering agent builds and deploys with. Yours, connected by you.</p>
          <Link href="/settings/connections" className="retro-button inline-block" data-testid="settings-connections">
            Manage connections
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Export</h2>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4 border border-surface-border bg-surface p-5">
          <p className="text-muted">Artifacts as MD, PDF and PPTX, your data as JSON and CSV. The code is already in your GitHub.</p>
          <Link href="/settings/export" className="retro-button inline-block" data-testid="settings-export">
            Export
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Standing rules</h2>
        <div className="mt-3">
          <AutoRulesList rules={rules} />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="mono-label text-faint">Usage and cost</h2>
          <span className="mono-label text-faint">last {COST_WINDOW_DAYS} days</span>
        </div>
        <div className="mt-3">
          <CostDashboard rows={costs} />
        </div>
      </section>
    </main>
  );
}
