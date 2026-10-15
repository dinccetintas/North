import type { PublicPageView } from "@north/core/public-page";
import { formatNumber, metricLabel } from "@/lib/labels";
import { SiteFooter } from "@/components/site-footer";

const percent = (current: number, target: number): number => (target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0);

/**
 * PUB-1: what `public_page_view` returned, every string a text node (no
 * markdown, no HTML), no session, no kill switch and no link into the app;
 * the only links are the owner's https site and the legal footer.
 */
export function PublicPage({ view }: { view: PublicPageView }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16" data-testid="public-page">
        <p className="mono-label text-faint" data-testid="public-name">
          {view.name}
        </p>
        <h1 className="mt-3 text-5xl leading-[1.05]" data-testid="public-headline">
          {view.headline}
        </h1>
        {view.blurb ? (
          <p className="mt-6 whitespace-pre-line text-lg text-muted" data-testid="public-blurb">
            {view.blurb}
          </p>
        ) : null}

        {view.goal ? (
          <section className="mt-10 border border-surface-border bg-surface p-5" data-testid="public-goal" data-key={view.goal.metricKey}>
            <h2 className="mono-label text-faint">Goal · {metricLabel(view.goal.metricKey)}</h2>
            <p className="mt-2 font-display text-4xl">
              {formatNumber(view.goal.current)}
              <span className="text-muted"> / {formatNumber(view.goal.target)}</span>
            </p>
            <div className="hairline mt-3 h-2 w-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(view.goal.current, view.goal.target)}>
              <div className="h-full bg-fg" style={{ width: `${percent(view.goal.current, view.goal.target)}%` }} />
            </div>
          </section>
        ) : null}

        {view.metrics.length > 0 ? (
          <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {view.metrics.map((m) => (
              <div key={m.key} className="border-t border-surface-border pt-3" data-testid="public-metric" data-key={m.key}>
                <dt className="mono-label text-faint">{metricLabel(m.key)}</dt>
                <dd className="mt-1 font-display text-3xl">{formatNumber(m.value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {view.siteUrl ? (
          <p className="mt-10">
            <a href={view.siteUrl} target="_blank" rel="noreferrer noopener" className="retro-button inline-block" data-testid="public-site">
              Visit the site
            </a>
          </p>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
