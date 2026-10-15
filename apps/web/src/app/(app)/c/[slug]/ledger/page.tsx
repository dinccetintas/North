import { notFound } from "next/navigation";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { LEDGER_WINDOW_DAYS, loadLedgerPage } from "@/lib/ledger-data";
import { BudgetStrip } from "@/components/budget-strip";
import { CampaignList } from "@/components/campaign-list";
import { ChannelReport } from "@/components/channel-report";
import { LedgerTable } from "@/components/ledger-table";
import { LiveRefresh } from "@/components/live-refresh";
import { OutreachList } from "@/components/outreach-list";

export const metadata = { title: "Ledger" };

type Params = Promise<{ slug: string }>;

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * OUT-1: the outcome ledger. What was spent against which cap, which campaign
 * or batch moved which metric at what cost, and the append-only entries behind
 * it. Reads under RLS; the worker alone writes. Refreshes while a campaign runs.
 */
export default async function LedgerPage({ params }: { params: Params }) {
  const { slug } = await params;
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const data = await loadLedgerPage(db, company.id);
  const empty = data.campaigns.length === 0 && data.entries.length === 0 && data.outreach.length === 0;
  const exportHref = `/api/companies/${encodeURIComponent(company.id)}/ledger.csv`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="mono-label text-faint">Last {LEDGER_WINDOW_DAYS} days</p>
          <h1 className="mt-1 text-4xl">Outcome ledger</h1>
        </div>
        <LiveRefresh active={data.live} />
      </div>

      <Section title="Budget">
        <BudgetStrip rows={data.budgets} />
      </Section>

      {empty ? (
        <p className="mt-10 border border-surface-border bg-surface p-5 text-muted" data-testid="ledger-empty">
          Nothing has been spent or sent yet. The first campaign or outreach batch you approve writes its spend, clicks and replies here.
        </p>
      ) : null}

      {data.campaigns.length > 0 ? (
        <Section title="Campaigns">
          <CampaignList campaigns={data.campaigns} />
        </Section>
      ) : null}

      {data.report.length > 0 ? (
        <Section title="Channels">
          <ChannelReport rows={data.report} />
        </Section>
      ) : null}

      {data.outreach.length > 0 ? (
        <Section title="Outreach">
          <OutreachList rows={data.outreach} />
        </Section>
      ) : null}

      <Section
        title="Entries"
        aside={
          <a href={exportHref} className="mono-label text-faint hover:text-fg hover:underline" data-testid="ledger-export" download>
            export csv ↓
          </a>
        }
      >
        {data.entries.length > 0 ? (
          <LedgerTable rows={data.entries} />
        ) : (
          <p className="border border-surface-border bg-surface p-5 text-muted">No entries yet.</p>
        )}
      </Section>
    </main>
  );
}
