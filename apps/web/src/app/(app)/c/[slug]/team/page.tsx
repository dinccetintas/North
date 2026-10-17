import { notFound } from "next/navigation";
import { getSenderIdentity, listAgents, listRecentActions, type ActionRecord } from "@north/db";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { formatNumber, roleTitle } from "@/lib/labels";
import { leadsCount } from "@/lib/ledger-data";
import { LeadsUpload } from "@/components/leads-upload";
import { SenderIdentityForm, type SenderIdentityValue } from "@/components/sender-identity-form";

export const metadata = { title: "Team" };

type Params = Promise<{ slug: string }>;

const ACTION_WINDOW_HOURS = 24;

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * Why a `blocked` row was blocked: the worker's `payload.blocked_reason`
 * (a fence target, a suppressed address, `no_sender_identity: no sender
 * identity`), else the gate's reasons (the kill switch); null for any other
 * status. Rendered as text, never as markup.
 */
function blockedReasonOf(action: ActionRecord): string | null {
  if (action.status !== "blocked") return null;
  const { blocked_reason: reason, reasons } = action.payload;
  if (typeof reason === "string" && reason.trim().length > 0) return reason;
  const listed = Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string") : [];
  return listed.length > 0 ? listed.join(", ") : null;
}

/** One line of the action stream; a blocked row carries its reason right after the status, where the line is not yet cut off. */
function ActionRow({ action: a }: { action: ActionRecord }) {
  const reason = blockedReasonOf(a);
  return (
    <div className="whitespace-nowrap" data-testid="action-row" data-kind={a.kind} data-status={a.status}>
      &gt; [{timeOf(a.createdAt)}] {a.agentRole} {a.kind} {a.tier} {a.supersedes ? "→ " : ""}
      {a.status}
      {a.sandbox && (a.status === "executed" || a.status === "notified") ? " (sandbox)" : ""}
      {reason ? (
        <>
          <span data-testid="action-blocked-reason"> — {reason}</span> —
        </>
      ) : null}{" "}
      {a.description}
    </div>
  );
}

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

/**
 * CMP-1 (M7): the legal name and postal address every first-contact email
 * carries; until they are saved the gate blocks first contacts, and the
 * action stream below says so.
 */
function SenderIdentitySection({ companyId, slug, identity }: { companyId: string; slug: string; identity: SenderIdentityValue | null }) {
  return (
    <section className="mt-10" data-testid="sender-identity-section">
      <h2 className="mono-label text-faint">{roleTitle("sales")} · Sender identity</h2>
      <div className="mt-3 border border-surface-border bg-surface p-5">
        {identity ? null : <p className="mb-4 text-muted">Not set yet: no first-contact email goes out until the company&apos;s legal name and postal address are here.</p>}
        <SenderIdentityForm companyId={companyId} slug={slug} identity={identity} />
      </div>
    </section>
  );
}

export default async function TeamPage({ params }: { params: Params }) {
  const { slug } = await params;
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const [agents, actions, leads, identity] = await Promise.all([
    listAgents(db, company.id),
    listRecentActions(db, company.id, ACTION_WINDOW_HOURS),
    leadsCount(db, company.id),
    getSenderIdentity(db, company.id),
  ]);

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
      <SenderIdentitySection companyId={company.id} slug={company.slug} identity={identity} />

      <section className="mt-10">
        <h2 className="mono-label text-faint">Last {ACTION_WINDOW_HOURS} hours</h2>
        <div className="terminal mt-3 overflow-x-auto px-4 py-3" data-testid="action-stream" aria-label="Agent actions">
          {actions.length === 0 ? (
            <div className="cursor-blink">&gt; no actions in the last {ACTION_WINDOW_HOURS} hours </div>
          ) : (
            <>
              {actions.map((a) => (
                <ActionRow key={a.id} action={a} />
              ))}
              <div className="cursor-blink">&gt; </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
