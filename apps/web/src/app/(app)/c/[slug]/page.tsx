import { notFound } from "next/navigation";
import { getCompanyBySlug } from "@north/db";
import { createClient } from "@/lib/supabase/server";
import { KillSwitch } from "@/components/kill-switch";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  return { title: slug };
}

export default async function CompanyHomePage({ params }: { params: Params }) {
  const { slug } = await params;
  const supabase = await createClient();
  const company = await getCompanyBySlug(supabase, slug);
  if (!company) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="mono-label text-faint">Morning · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-1 text-4xl" data-testid="company-name">
            {company.name}
          </h1>
        </div>
        <KillSwitch companyId={company.id} active={company.killSwitchActive} />
      </div>

      {company.killSwitchActive ? (
        <p className="mono-label mt-6 border border-error bg-error-bg px-3 py-3 text-error" role="status">
          All agents are stopped. Queue frozen, campaigns paused.
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="mono-label text-faint">Brief</h2>
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">
          Your first brief arrives after the research agent finishes the market report and the Chief of Staff writes
          the weekly plan.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Decisions today · 0 of 3</h2>
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">Nothing to decide yet.</p>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Goal</h2>
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">No goal set. Step 2 of onboarding.</p>
      </section>
    </main>
  );
}
