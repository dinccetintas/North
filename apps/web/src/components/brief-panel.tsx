import Link from "next/link";
import { briefEmptyText, wordsLabel, type BriefView } from "@/lib/brief-view";
import { roleTitle, tierLabel } from "@/lib/labels";
import { BriefEscalations, BriefMetrics, BriefSection, BriefSignals, BriefSpend, BriefYesterday, Nothing } from "@/components/brief-sections";
import { TaskStatusBadge } from "@/components/task-list";
import { OfflineBriefCache } from "@/components/offline-brief-cache";

function Decisions({ brief, slug }: { brief: BriefView; slug: string }) {
  const { pending, deferred, answeredYesterday } = brief.decisions;
  return (
    <BriefSection title="Decisions" testId="brief-decisions">
      {pending.length === 0 ? (
        <Nothing text="No cards waiting." />
      ) : (
        <ul className="flex flex-col gap-1">
          {pending.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className={`mono-label ${c.tier === "K3" ? "text-error" : "text-deep"}`}>{tierLabel(c.tier)}</span>
              <Link href={`/c/${slug}/decisions/${c.id}`} className="hover:underline" data-testid="brief-card" data-card-id={c.id}>
                {c.question}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mono-label mt-1.5 text-faint">
        <span data-testid="brief-deferred">{deferred}</span> deferred · {answeredYesterday} answered yesterday
      </p>
    </BriefSection>
  );
}

function Today({ brief }: { brief: BriefView }) {
  return (
    <BriefSection title="Today" testId="brief-today">
      {brief.today.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="flex flex-col gap-1">
          {brief.today.map((t) => (
            <li key={t.taskId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" data-testid="brief-task" data-task-id={t.taskId}>
              <TaskStatusBadge status={t.status} />
              <span className="mono-label text-muted">{roleTitle(t.role)}</span>
              <span>{t.title}</span>
            </li>
          ))}
        </ul>
      )}
    </BriefSection>
  );
}

export interface BriefPanelProps {
  /** The signed-in owner; the offline copy is kept under this id (PWA-1, M6 review L14). Null keeps no copy. */
  readonly userId: string | null;
  readonly slug: string;
  readonly brief: BriefView | null;
  /** The owner's IANA zone: names the hour the first brief arrives. */
  readonly timezone: string;
  /** The owner's brief hour (BRF-1, 0..23); the empty state names it. */
  readonly briefHour?: number;
}

/**
 * BRF-1: the morning brief, first on the home screen, readable in 60 seconds.
 * Composed by core from the ledger (not a model), one row per owner-local day;
 * the sections keep the brief's fixed order and every line is text.
 */
export function BriefPanel({ userId, slug, brief, timezone, briefHour }: BriefPanelProps) {
  if (!brief) {
    return (
      <section className="mt-10" data-testid="brief-empty">
        <h2 className="mono-label text-faint">Morning brief</h2>
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">{briefEmptyText(timezone, briefHour)}</p>
      </section>
    );
  }
  return (
    <section className="mt-10" data-testid="brief" data-brief-date={brief.day} data-stopped={brief.stopped ? "true" : "false"}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint">Morning brief · {brief.day}</h2>
        <span className="mono-label text-faint" data-testid="brief-words">
          {wordsLabel(brief.wordCount)}
        </span>
      </div>
      <article className="mt-3 flex flex-col gap-3 border border-surface-border bg-surface p-5">
        <h3 className="text-2xl" data-testid="brief-headline">
          {brief.headline}
        </h3>
        {brief.blocked ? (
          <p className="mono-label text-warning" data-testid="brief-blocked" data-reason={brief.blocked.reason}>
            {brief.blocked.text}{" "}
            <Link href="/settings/billing" className="underline">
              Billing
            </Link>
          </p>
        ) : null}
        {brief.stopped ? (
          <p className="mono-label text-error" data-testid="brief-stopped">
            All agents are stopped (kill switch).
          </p>
        ) : null}
        <BriefYesterday brief={brief} />
        <BriefMetrics brief={brief} />
        <Decisions brief={brief} slug={slug} />
        <Today brief={brief} />
        <BriefSpend brief={brief} />
        <BriefSignals brief={brief} />
        <BriefEscalations brief={brief} />
        <p className="mono-label text-faint">Written by the {roleTitle("chief_of_staff")} from the ledger, in its name.</p>
      </article>
      {userId ? <OfflineBriefCache userId={userId} slug={slug} brief={brief} /> : null}
    </section>
  );
}
