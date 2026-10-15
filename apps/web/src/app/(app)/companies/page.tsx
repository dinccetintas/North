import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ownerCompanies, ownerEntitlement, ownerProfile } from "@/lib/account";
import { loadPortfolio } from "@/lib/portfolio-data";
import { activeCompanyCount, companyRows, newCompanyGate, portfolioView } from "@/lib/portfolio-view";
import { CompanyRows } from "@/components/company-rows";
import { InstallPrompt } from "@/components/install-prompt";
import { PortfolioBrief, PortfolioEmpty } from "@/components/portfolio-brief";

export const metadata = { title: "Companies" };

/**
 * MULTI-1: the portfolio. One brief across the owner's companies, composed
 * from today's briefs only, then one row per company. The install bar
 * (PWA-1) sits on this screen, the manifest's start URL.
 */
export default async function CompaniesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [companies, profile, entitlement] = await Promise.all([ownerCompanies(), ownerProfile(user.id), ownerEntitlement(user.id)]);
  const portfolio = await loadPortfolio(await createClient(), companies, profile?.timezone ?? "UTC", new Date());
  const gate = newCompanyGate(entitlement, activeCompanyCount(companies));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-4xl">Your companies</h1>
        <Link href="/new" className={`retro-button ${gate.allowed ? "retro-button-primary" : ""}`} data-testid="companies-new" data-disabled={gate.allowed ? "false" : "true"}>
          New company
        </Link>
      </div>

      <InstallPrompt />

      {companies.length === 0 ? (
        <p className="mt-10 border border-surface-border bg-surface p-6 text-muted">
          No company yet. Start one: a thesis, a goal and a budget are all it takes.
        </p>
      ) : (
        <>
          {portfolio.brief ? <PortfolioBrief view={portfolioView(portfolio.brief)} /> : <PortfolioEmpty day={portfolio.day} />}
          <h2 className="mono-label mt-10 text-faint">Companies</h2>
          <div className="mt-3">
            <CompanyRows rows={companyRows(companies, portfolio.pending, portfolio.goals)} />
          </div>
        </>
      )}
    </main>
  );
}
