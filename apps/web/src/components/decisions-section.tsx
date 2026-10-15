import Link from "next/link";
import { cardsOpenedToday, getProfile, listCards, listPendingCards, type CardRecord } from "@north/db";
import { DEFAULT_DAILY_QUOTA } from "@north/core/decisions/types";
import { createClient, currentUser } from "@/lib/supabase/server";
import { splitRationale } from "@/lib/card-facts";
import { formatAnsweredAt } from "@/lib/labels";
import { DecisionCard, type DecisionCardData } from "@/components/decision-card";

const ANSWERED_LIMIT = 20;

/** The card's facts line is the gate's "Details:" tail; the card shows the sentence and the facts apart. */
export function toCardData(card: CardRecord): DecisionCardData {
  const { summary, facts } = splitRationale(card.rationale);
  return {
    id: card.id,
    question: card.question,
    options: card.options,
    recommendedOptionId: card.recommendedOptionId,
    defaultOptionId: card.defaultOptionId,
    rationale: summary,
    expectedImpact: card.expectedImpact,
    costUsd: card.costUsd,
    dueAt: card.dueAt,
    tier: card.tier,
    answeredOptionId: card.answeredOptionId,
    actionKind: card.actionKind,
    facts,
  };
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * The morning screen's centre: pending cards (never more than the quota), the
 * "n of q" counter, and today's answered cards folded below (DEC-2/3).
 */
export async function DecisionsSection({ slug, companyId, stopped = false }: { slug: string; companyId: string; stopped?: boolean }) {
  const db = await createClient();
  const user = await currentUser();
  const [pending, recent, openedToday, profile] = await Promise.all([
    listPendingCards(db, companyId),
    listCards(db, companyId, { limit: ANSWERED_LIMIT }),
    cardsOpenedToday(db, companyId),
    user ? getProfile(db, user.id) : Promise.resolve(null),
  ]);
  const quota = profile?.dailyDecisionQuota ?? DEFAULT_DAILY_QUOTA;
  const answeredToday = recent.filter((c) => c.answeredAt && c.day === todayIso());

  return (
    <section className="mt-10" data-testid="decisions">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint" data-testid="decisions-counter">
          Decisions today · {openedToday} of {quota}
        </h2>
        {pending.length > 0 ? <span className="mono-label text-deep">{pending.length} waiting</span> : null}
      </div>

      {pending.length === 0 ? (
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted" data-testid="decisions-empty">
          Nothing to decide right now. Agents only ask when money, reputation or a new contact is on the line.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3" data-testid="pending-cards">
          {pending.map((card) => (
            <DecisionCard key={card.id} slug={slug} card={toCardData(card)} stopped={stopped} />
          ))}
        </div>
      )}

      {answeredToday.length > 0 ? (
        <details className="mt-3 border border-surface-border" data-testid="answered-cards">
          <summary className="mono-label cursor-pointer px-4 py-3 text-faint">Decided today · {answeredToday.length}</summary>
          <ul className="divide-y divide-surface-border border-t border-surface-border">
            {answeredToday.map((card) => (
              <li key={card.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3" data-testid="answered-card" data-card-id={card.id}>
                <Link href={`/c/${slug}/decisions/${card.id}`} className="hover:underline">
                  {card.question}
                </Link>
                <span className="mono-label text-success">
                  {card.options.find((o) => o.id === card.answeredOptionId)?.label ?? card.answeredOptionId}
                  {card.answeredBy === "default" ? " (default)" : card.answeredBy === "auto_rule" ? " (rule)" : ""}
                  {card.answeredAt ? ` · ${formatAnsweredAt(card.answeredAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
