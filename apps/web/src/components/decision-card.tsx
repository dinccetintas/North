"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { answerCardAction } from "@/app/(app)/c/[slug]/decisions/actions";
import { formatDue, formatUsd, tierLabel } from "@/lib/labels";

/** Serialisable slice of a `CardRecord` the card needs; the page passes it from the server. */
export interface DecisionCardData {
  readonly id: string;
  readonly question: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly recommendedOptionId: string;
  readonly defaultOptionId: string | null;
  readonly rationale: string;
  readonly expectedImpact: string | null;
  readonly costUsd: number;
  readonly dueAt: string;
  readonly tier: string;
  readonly answeredOptionId: string | null;
  /** The gated action's kind (`ads.start`, `budget.cap.raise`, `email.send.first_contact`, …). */
  readonly actionKind: string;
  /** The load-bearing facts of the action ("$10/day, audience: …", "spent $11 of $10 today", "5 emails: …"); null when the gate gave none. */
  readonly facts: string | null;
}

export interface DecisionCardProps {
  readonly slug: string;
  readonly card: DecisionCardData;
  /** Show the rationale and the detail link (home); the detail page passes false. */
  readonly compact?: boolean;
}

/**
 * One decision, one tap (DEC-2). The recommended option is highlighted; every
 * option is a button. After the tap the card shows the answer at once and the
 * server action tells the worker.
 */
export function DecisionCard({ slug, card, compact = true }: DecisionCardProps) {
  const [pending, startTransition] = useTransition();
  const [answered, setAnswered] = useState<string | null>(card.answeredOptionId);
  const [error, setError] = useState<string | null>(null);

  const answer = (optionId: string) =>
    startTransition(async () => {
      const result = await answerCardAction({ slug, cardId: card.id, optionId });
      if (result.ok) {
        setAnswered(result.value.optionId);
        setError(null);
      } else {
        setError(result.error);
      }
    });

  const answeredLabel = answered ? (card.options.find((o) => o.id === answered)?.label ?? answered) : null;

  return (
    <article
      className={`border bg-surface p-5 ${answered ? "border-surface-border" : "border-fg"}`}
      data-testid="decision-card"
      data-card-id={card.id}
      data-action-kind={card.actionKind}
      data-answered={answered ?? ""}
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={`mono-label ${card.tier === "K3" ? "text-error" : "text-deep"}`}>{tierLabel(card.tier)}</span>
        <span className="mono-label text-faint">
          {card.costUsd > 0 ? `${formatUsd(card.costUsd)} · ` : ""}
          {formatDue(card.dueAt)}
        </span>
      </div>
      {compact ? (
        <>
          <h3 className="mt-3 text-2xl">
            <Link href={`/c/${slug}/decisions/${card.id}`} className="hover:underline">
              {card.question}
            </Link>
          </h3>
          <p className="mt-2 text-muted">{card.rationale}</p>
        </>
      ) : null}
      {card.facts ? (
        <p className="mono-label mt-3 text-fg" data-testid="card-facts">
          {card.facts}
        </p>
      ) : null}
      {card.expectedImpact ? <p className="mono-label mt-2 text-faint">expected: {card.expectedImpact}</p> : null}

      {answered ? (
        <p className="mono-label mt-4 text-success" data-testid="card-answered">
          Answered: {answeredLabel}
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3" role="group" aria-label="Your answer">
          {card.options.map((option) => {
            const recommended = option.id === card.recommendedOptionId;
            return (
              <button
                key={option.id}
                type="button"
                disabled={pending}
                onClick={() => answer(option.id)}
                data-testid={`answer-${option.id}`}
                className={recommended ? "retro-button retro-button-primary" : "retro-button"}
              >
                {option.label}
                {recommended ? " ★" : ""}
              </button>
            );
          })}
        </div>
      )}

      {!answered ? (
        <p className="mono-label mt-3 text-faint">
          {card.defaultOptionId
            ? `No answer by the deadline → ${card.options.find((o) => o.id === card.defaultOptionId)?.label ?? card.defaultOptionId}`
            : "No default: nothing happens until you answer"}
        </p>
      ) : null}
      {error ? (
        <p className="mono-label mt-3 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
