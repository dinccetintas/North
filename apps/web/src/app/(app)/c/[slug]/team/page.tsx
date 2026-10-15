import { notFound } from "next/navigation";
import { listAgents, listRecentActions } from "@north/db";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { formatNumber, roleTitle } from "@/lib/labels";
import { leadsCount } from "@/lib/ledger-data";
import { LeadsUpload } from "@/components/leads-upload";

export const metadata = { title: "Team" };

type Params = Promise<{ slug: string }>;

const ACTION_WINDOW_HOURS = 24;

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** M4: the Sales role's prospect list; fed by CSV upload here and by `lead_research` tasks. */
function LeadsSection({ companyId, count }: { companyId: string; count: number }) {
  return (
    <section className="mt-10" data-testid="leads-section">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint">{roleTitle("sales")} · Leads</h2>
        <span className="mono-label text-faint">
          <span data-testid="leads-count">{formatNumber(count)}</span> known
        </span>
      </div>
      <div className="mt-3 border border-surface-border bg-surface p-5">
        <p className="text-muted">
          {count === 0 ? "No leads yet. Upload a CSV or let Sales research a list; " : `${formatNumber(count)} prospects. `}
          First contact always goes through one card per batch, from your own mailbox.
        </p>
        <div className="mt-4">
          <LeadsUpload companyId={companyId} />
        </div>
      </div>
    </section>
  );
}

export default async function TeamPage({ params }: { params: Params }) {
  const { slug } = await params;
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const [agents, actions, leads] = await Promise.all([listAgents(db, company.id), listRecentActions(db, company.id, ACTION_WINDOW_HOURS), leadsCount(db, company.id)]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="mono-label text-faint">{agents.length} roles</p>
      <h1 className="mt-1 text-4xl">Team</h1>

      {agents.length === 0 ? (
        <p className="mt-8 border border-surface-border bg-surface p-5 text-muted">
          The eight roles are created when onboarding completes.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-px border border-surface-border bg-surface-border sm:grid-cols-4" data-testid="role-cards">
          {agents.map((agent) => (
            <li key={agent.id} className="flex flex-col gap-2 bg-bg p-4" data-testid="role-card">
              <span className="font-display text-xl leading-tight">{roleTitle(agent.role)}</span>
              <span className="mono-label text-faint">{agent.role}</span>
              <span className="mt-auto flex items-center gap-2">
                <span className="mono-label hairline px-1.5 py-0.5">max {agent.maxActionTier}</span>
                <span className={`mono-label ${agent.enabled ? "text-success" : "text-faint"}`}>{agent.enabled ? "enabled" : "off"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <LeadsSection companyId={company.id} count={leads} />

      <section className="mt-10">
        <h2 className="mono-label text-faint">Last {ACTION_WINDOW_HOURS} hours</h2>
        <div className="terminal mt-3 overflow-x-auto px-4 py-3" data-testid="action-stream" aria-label="Agent actions">
          {actions.length === 0 ? (
            <div className="cursor-blink">&gt; no actions in the last {ACTION_WINDOW_HOURS} hours </div>
          ) : (
            <>
              {actions.map((a) => (
                <div key={a.id} className="whitespace-nowrap" data-testid="action-row" data-kind={a.kind} data-status={a.status}>
                  &gt; [{timeOf(a.createdAt)}] {a.agentRole} {a.kind} {a.tier} {a.supersedes ? "→ " : ""}
                  {a.status}
                  {a.sandbox && (a.status === "executed" || a.status === "notified") ? " (sandbox)" : ""} {a.description}
                </div>
              ))}
              <div className="cursor-blink">&gt; </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
