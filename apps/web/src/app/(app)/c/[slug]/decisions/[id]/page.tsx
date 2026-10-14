import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCard, getTask, listActiveAutoRules, listAnsweredCards, listArtifacts, type ArtifactRecord, type TaskRecord } from "@north/db";
import { suggestAutoRule } from "@north/core/decisions/autorule";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { formatDue, formatUsd, roleTitle, tierLabel } from "@/lib/labels";
import { DecisionCard } from "@/components/decision-card";
import { toCardData } from "@/components/decisions-section";
import { AutoRuleProposal } from "@/components/auto-rule-proposal";
import { TaskStatusBadge } from "@/components/task-list";

type Params = Promise<{ slug: string; id: string }>;

const IdSchema = z.string().uuid();
const EVIDENCE_LIMIT = 3;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return { title: "Decision" };
  const db = await createClient();
  const card = await getCard(db, id);
  return { title: card?.question ?? "Decision" };
}

/** Artifacts the requesting role produced; the closest thing to evidence for a card until actions carry artifact links. */
function evidenceFor(task: TaskRecord | null, artifacts: readonly ArtifactRecord[]): readonly ArtifactRecord[] {
  if (!task) return [];
  return artifacts.filter((a) => a.createdByRole === task.role).slice(0, EVIDENCE_LIMIT);
}

/** Card detail: everything behind the one-line question (DEC-2), plus the auto-rule proposal after three identical answers (DEC-3). */
export default async function DecisionPage({ params }: { params: Params }) {
  const { slug, id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const card = await getCard(db, id);
  if (!card || card.companyId !== company.id) notFound();

  const [task, artifacts, history, rules] = await Promise.all([
    card.taskId ? getTask(db, card.taskId) : Promise.resolve(null),
    listArtifacts(db, company.id),
    card.answeredAt ? listAnsweredCards(db, company.id, card.actionKind) : Promise.resolve([]),
    card.answeredAt ? listActiveAutoRules(db, company.id) : Promise.resolve([]),
  ]);
  const evidence = evidenceFor(task, artifacts);
  const suggestion = card.answeredAt && !rules.some((r) => r.kind === card.actionKind) ? suggestAutoRule(history) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href={`/c/${slug}`} className="mono-label text-faint hover:text-fg hover:underline">
        ← Home
      </Link>
      <p className="mono-label mt-4 text-faint">
        Decision #{card.seq} · {card.day} · {card.actionKind}
      </p>
      <h1 className="mt-1 text-4xl" data-testid="decision-question">
        {card.question}
      </h1>

      <div className="mt-8">
        <DecisionCard slug={slug} card={toCardData(card)} compact={false} />
      </div>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Why</h2>
        <p className="mt-3 border border-surface-border bg-surface p-5" data-testid="decision-rationale">
          {card.rationale}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">At a glance</h2>
        <dl className="mt-3 grid grid-cols-2 gap-px border border-surface-border bg-surface-border sm:grid-cols-4">
          {[
            ["Tier", tierLabel(card.tier)],
            ["Cost", formatUsd(card.costUsd)],
            ["Deadline", formatDue(card.dueAt)],
            ["Safe default", card.defaultOptionId ? (card.options.find((o) => o.id === card.defaultOptionId)?.label ?? card.defaultOptionId) : "none"],
          ].map(([label, value]) => (
            <div key={label} className="bg-bg p-4">
              <dt className="mono-label text-faint">{label}</dt>
              <dd className="mt-1">{value}</dd>
            </div>
          ))}
        </dl>
        {card.expectedImpact ? <p className="mono-label mt-3 text-faint">expected impact: {card.expectedImpact}</p> : null}
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Evidence</h2>
        {task ? (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 border border-surface-border bg-surface p-5" data-testid="decision-task">
            <TaskStatusBadge status={task.status} />
            <span className="mono-label text-muted">{roleTitle(task.role)}</span>
            <span>{task.title}</span>
          </p>
        ) : null}
        {evidence.length === 0 ? (
          <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">No artifact is attached to this decision yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-surface-border border border-surface-border" data-testid="decision-evidence">
            {evidence.map((a) => (
              <li key={a.id}>
                <Link href={`/c/${slug}/artifacts/${a.id}`} className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-surface">
                  <span>{a.title}</span>
                  <span className="mono-label text-faint">v{a.version}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {suggestion ? (
        <section className="mt-10">
          <h2 className="mono-label text-faint">Don&apos;t ask again?</h2>
          <div className="mt-3">
            <AutoRuleProposal slug={slug} cardId={card.id} kind={suggestion.kind} maxAmountUsd={suggestion.maxAmountUsd} category={suggestion.category ?? null} repeats={suggestion.basedOn.length} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
