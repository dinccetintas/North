import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isActive } from "@north/core/billing/entitlements";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ownerCompanies, ownerProfile } from "@/lib/account";
import { loadBillingPage, loadCheckoutState } from "@/lib/billing-data";
import { billingSummary, creditEntryRows, packCards, planCards } from "@/lib/billing-view";
import { activeCompanyCount } from "@/lib/portfolio-view";
import { usageView } from "@/lib/usage-view";
import { BillingConfirming } from "@/components/billing-confirming";
import { BillingStatus } from "@/components/billing-status";
import { CreditsPanel } from "@/components/credits-panel";
import { PlanGrid } from "@/components/plan-grid";
import { UsagePanel } from "@/components/usage-panel";

export const metadata = { title: "Plan and credits" };

type SearchParams = Promise<{ checkout?: string; canceled?: string; error?: string }>;

const SessionIdSchema = z.uuid();

/**
 * BIL-1 / BIL-2: the plan, this month's usage against its price, the plan
 * grid, credits and their ledger. Everything here is read under RLS; the
 * buttons only ask the worker for a Stripe page.
 */
export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([currentUser(), searchParams]);
  if (!user) redirect("/login");
  const db = await createClient();
  const [profile, companies] = await Promise.all([ownerProfile(user.id), ownerCompanies()]);
  const now = new Date();
  const data = await loadBillingPage(db, user.id, profile?.timezone ?? "UTC", now);
  const checkoutId = params.checkout && SessionIdSchema.safeParse(params.checkout).success ? params.checkout : null;
  const checkout = params.checkout === undefined ? null : await loadCheckoutState(db, user.id, checkoutId);
  const entitlement = data.entitlement;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/settings" className="mono-label text-faint hover:underline">
        ← Settings
      </Link>
      <h1 className="mt-1 text-4xl">Plan and credits</h1>

      {params.error ? (
        <p className="mono-label mt-6 border border-error bg-error-bg px-3 py-3 text-error" role="alert">
          {params.error}
        </p>
      ) : null}
      {params.canceled ? (
        <p className="mono-label mt-6 border border-surface-border bg-surface px-3 py-3 text-muted" data-testid="billing-canceled">
          Checkout canceled. Nothing changed.
        </p>
      ) : null}
      {checkout ? <BillingConfirming sessionId={checkoutId} confirmed={checkout.confirmed} /> : null}

      {entitlement ? (
        <BillingStatus summary={billingSummary(entitlement, activeCompanyCount(companies), now)} />
      ) : (
        <p className="mt-8 border border-surface-border bg-surface p-5 text-muted" data-testid="billing-none">
          No plan yet. Choose one below.
        </p>
      )}

      <UsagePanel usage={usageView(data.usage, entitlement?.priceUsd ?? 0)} period={data.period} />

      <section className="mt-10">
        <h2 className="mono-label text-faint">Plans</h2>
        <div className="mt-3">
          <PlanGrid plans={planCards(entitlement)} />
        </div>
        <p className="mono-label mt-2 text-faint">Monthly, in USD. Payment happens on Stripe; North never sees your card.</p>
      </section>

      <CreditsPanel balance={data.balance} packs={packCards()} entries={creditEntryRows(data.entries)} canBuy={entitlement !== null && isActive(entitlement)} />

      <section className="mt-10 flex flex-wrap items-baseline justify-between gap-4 border border-surface-border bg-surface p-5">
        <p className="text-muted">Your data, artifacts and code are yours: export them any time, also after a subscription ends.</p>
        <Link href="/settings/export" className="retro-button inline-block" data-testid="billing-export-link">
          Export
        </Link>
      </section>
    </main>
  );
}
