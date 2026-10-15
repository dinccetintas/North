import Link from "next/link";
import { scoreLabel, type SignalRowData } from "@/lib/brief-view";
import { signalSourceLabel, signalStatusClass, signalStatusLabel } from "@/lib/labels";

/** Statuses that mean a card exists or existed for the signal; the row links to it. */
const LINKED_STATUSES: ReadonlySet<string> = new Set(["card_opened", "approved", "declined"]);

/**
 * PRO-1: what the research scan saw in the last seven days and what became of
 * it. Owners read; the worker writes. A signal becomes a card only through the
 * gate, so the row links to the card when one was opened.
 */
export function SignalsList({ slug, signals }: { slug: string; signals: readonly SignalRowData[] }) {
  return (
    <section className="mt-10">
      <h2 className="mono-label text-faint">Signals · last 7 days</h2>
      {signals.length === 0 ? (
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted" data-testid="signals-empty">
          Nothing yet. The research agent scans its sources every six hours and turns the one signal worth attention into a card.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-surface-border border border-surface-border" data-testid="signals">
          {signals.map((s) => (
            <li
              key={s.id}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 bg-surface px-4 py-3"
              data-testid="signal-row"
              data-signal-id={s.id}
              data-kind={s.kind}
              data-source={s.source}
              data-status={s.status}
            >
              <span className="mono-label text-muted">
                {signalSourceLabel(s.source)} · <span data-testid="signal-score">{scoreLabel(s.score)}</span>
              </span>
              <span className={`mono-label text-right ${signalStatusClass(s.status)}`} data-testid="signal-status">
                {signalStatusLabel(s.status)}
              </span>
              <span className="col-span-2" data-testid="signal-title">
                {s.cardId && LINKED_STATUSES.has(s.status) ? (
                  <Link href={`/c/${slug}/decisions/${s.cardId}`} className="hover:underline" data-testid="signal-card-link">
                    {s.title}
                  </Link>
                ) : (
                  s.title
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
