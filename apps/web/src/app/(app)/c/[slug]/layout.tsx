import { notFound } from "next/navigation";
import { companyBySlug } from "@/lib/company";
import { CompanyNav } from "@/components/company-nav";
import { KillSwitch } from "@/components/kill-switch";

type Params = Promise<{ slug: string }>;

/** Shared chrome for every company screen: name, section nav and the kill switch (visible everywhere). */
export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { slug } = await params;
  const company = await companyBySlug(slug);
  if (!company) notFound();

  return (
    <>
      <div className="border-b border-surface-border">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-5">
            <span className="mono-label truncate text-fg" data-testid="company-nav-name">
              {company.name}
            </span>
            <CompanyNav slug={slug} />
          </div>
          <KillSwitch companyId={company.id} active={company.killSwitchActive} />
        </div>
      </div>
      {company.killSwitchActive ? (
        <p className="mono-label mx-auto mt-4 w-full max-w-3xl border border-error bg-error-bg px-3 py-3 text-error sm:px-6" role="status">
          All agents are stopped. Queue frozen, campaigns paused.
        </p>
      ) : null}
      {children}
    </>
  );
}
