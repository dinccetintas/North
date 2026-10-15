import { isHttpUrl } from "@north/core/url";
import { scoreLabel, type SignalDetailData } from "@/lib/brief-view";
import { signalSourceLabel } from "@/lib/labels";

/**
 * PRO-1: the signal behind a `signal.pursue` card. The excerpt is the source's
 * text and is rendered as text (React escapes it; a literal `<b>` shows as
 * `<b>`); evidence links are http(s) only, already filtered by the view model
 * and checked once more here.
 */
export function DecisionSignal({ signal }: { signal: SignalDetailData }) {
  const links = signal.evidence.filter((url) => isHttpUrl(url));
  return (
    <section className="mt-10">
      <h2 className="mono-label text-faint">Signal</h2>
      <div className="mt-3 border border-surface-border bg-surface p-5" data-testid="decision-signal" data-signal-id={signal.id} data-source={signal.source}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-display text-xl leading-tight">{signal.title}</span>
          <span className="mono-label text-muted">
            {signalSourceLabel(signal.source)} · score <span data-testid="signal-score">{scoreLabel(signal.score)}</span>
          </span>
        </div>
        {signal.summary ? <p className="mt-3 text-muted">{signal.summary}</p> : null}
        <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-surface-border pl-4 text-muted" data-testid="signal-excerpt">
          {signal.excerpt.length > 0 ? signal.excerpt : "No excerpt."}
        </blockquote>
        <p className="mono-label mt-3 text-faint">Evidence</p>
        {links.length === 0 ? (
          <p className="mt-1 text-muted" data-testid="signal-evidence">
            No link: the source gave none.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1" data-testid="signal-evidence">
            {links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer noopener" className="break-all hover:underline">
                  {url} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-muted">Approve opens a research task on this signal; decline (the default) records it and nothing else happens.</p>
      </div>
    </section>
  );
}
