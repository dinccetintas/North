"use client";

import { useEffect, useState } from "react";
import { pickBrief, readCachedBriefs, slugFromPath, type CachedBrief } from "@/lib/offline-brief";
import { wordsLabel } from "@/lib/brief-view";
import { BriefEscalations, BriefMetrics, BriefSection, BriefSignals, BriefSpend, BriefYesterday, Nothing } from "@/components/brief-sections";

type State = { readonly kind: "loading" } | { readonly kind: "none" } | { readonly kind: "brief"; readonly entry: CachedBrief };

/** Decisions offline: the questions as text only. A card is answered online, never from this copy. */
function OfflineDecisions({ entry }: { entry: CachedBrief }) {
  const { pending, deferred } = entry.brief.decisions;
  return (
    <BriefSection title="Decisions" testId="brief-decisions">
      {pending.length === 0 ? (
        <Nothing text="No cards waiting." />
      ) : (
        <ul className="flex flex-col gap-1">
          {pending.map((c) => (
            <li key={c.id} className="text-muted">
              {c.question}
            </li>
          ))}
        </ul>
      )}
      <p className="mono-label mt-1.5 text-faint">{deferred} deferred · answer cards when you are back online</p>
    </BriefSection>
  );
}

/**
 * PWA-1: the latest brief from Cache Storage, rendered with the home
 * screen's own sections. The company the user navigated to when it is
 * cached, else the newest. Every string is a text node.
 */
export function OfflineBrief() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const slug = slugFromPath(window.location.pathname);
    void readCachedBriefs()
      .then((entries) => {
        const entry = pickBrief(entries, slug);
        if (!cancelled) setState(entry ? { kind: "brief", entry } : { kind: "none" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p className="mono-label mt-6 text-faint">Reading the saved brief…</p>;
  if (state.kind === "none") {
    return (
      <p className="mt-6 border border-surface-border bg-surface p-5 text-muted" data-testid="offline-brief-empty">
        No brief saved on this device yet. Open a company once while online.
      </p>
    );
  }

  const { brief } = state.entry;
  return (
    <section className="mt-6" data-testid="offline-brief" data-brief-date={brief.day} data-offline="true" data-slug={state.entry.slug}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint">
          {brief.companyName} · morning brief · {brief.day}
        </h2>
        <span className="mono-label text-faint">{wordsLabel(brief.wordCount)}</span>
      </div>
      <article className="mt-3 flex flex-col gap-3 border border-surface-border bg-surface p-5">
        <h3 className="text-2xl" data-testid="brief-headline">
          {brief.headline}
        </h3>
        {brief.blocked ? (
          <p className="mono-label text-warning" data-testid="brief-blocked" data-reason={brief.blocked.reason}>
            {brief.blocked.text}
          </p>
        ) : null}
        {brief.stopped ? <p className="mono-label text-error">All agents are stopped (kill switch).</p> : null}
        <BriefYesterday brief={brief} />
        <BriefMetrics brief={brief} />
        <OfflineDecisions entry={state.entry} />
        <BriefSpend brief={brief} />
        <BriefSignals brief={brief} />
        <BriefEscalations brief={brief} />
      </article>
    </section>
  );
}
