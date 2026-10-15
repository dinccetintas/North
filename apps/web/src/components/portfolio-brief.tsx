import Link from "next/link";
import type { PortfolioCompanyView, PortfolioView } from "@/lib/portfolio-view";

function CompanySection({ company }: { company: PortfolioCompanyView }) {
  return (
    <section
      className="border-t border-surface-border pt-3"
      data-testid="portfolio-company"
      data-company-id={company.companyId}
      data-slug={company.slug}
      data-paused={company.paused ? "true" : "false"}
      data-paused-reason={company.pausedReason}
    >
      <h3 className="flex flex-wrap items-baseline gap-x-3 text-xl">
        <span>{company.name}</span>
        <span className={`mono-label ${company.paused ? "text-error" : "text-faint"}`} data-testid="portfolio-headline">
          {company.headline}
        </span>
      </h3>
      {company.pending.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {company.pending.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
              <span className="mono-label text-deep">Decide</span>
              <Link href={p.href} className="hover:underline" data-testid="portfolio-pending" data-card-id={p.id}>
                {p.question}
              </Link>
              <span className="mono-label text-faint">due {p.due}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {company.outcomes.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-muted" data-testid="portfolio-outcomes">
          {company.outcomes.map((line, i) => (
            <li key={`${i}-${line}`}>Yesterday: {line}</li>
          ))}
        </ul>
      ) : null}
      {company.held ? (
        <p className="mono-label mt-1.5 text-faint" data-testid="portfolio-held">
          {company.held}
        </p>
      ) : null}
      {company.pending.length === 0 && company.outcomes.length === 0 && !company.held ? <p className="mt-1 text-muted">Nothing.</p> : null}
    </section>
  );
}

/**
 * MULTI-1: one brief across the owner's companies, composed in core from
 * today's briefs (companies with cards first, at most 300 words). Every
 * question and outcome is a text node; cards link to their detail pages.
 */
export function PortfolioBrief({ view }: { view: PortfolioView }) {
  return (
    <section className="mt-8" data-testid="portfolio-brief">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint">
          Portfolio brief · <span data-testid="portfolio-day">{view.day}</span>
        </h2>
        <span className="mono-label text-faint" data-testid="portfolio-words" data-words={view.wordCount}>
          {view.words}
        </span>
      </div>
      <article className="mt-3 flex flex-col gap-3 border border-surface-border bg-surface p-5">
        <p className="font-display text-2xl" data-testid="portfolio-totals">
          {view.totals}
        </p>
        {view.companies.map((company) => (
          <CompanySection key={company.companyId} company={company} />
        ))}
      </article>
    </section>
  );
}

/** Before `generate-brief` has written today's row for any company. */
export function PortfolioEmpty({ day }: { day: string }) {
  return (
    <section className="mt-8" data-testid="portfolio-empty" data-day={day}>
      <h2 className="mono-label text-faint">Portfolio brief · {day}</h2>
      <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">No brief yet today</p>
    </section>
  );
}
