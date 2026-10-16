import Link from "next/link";
import { stripArtifacts } from "@/lib/artifact-strip";
import { artifactKindLabel } from "@/lib/labels";

export interface ArtifactStripItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly version: number;
  readonly createdAt: string;
}

/** The latest artifacts (a recent incident report pinned first), each linking to its page. */
export function ArtifactsStrip({ slug, artifacts }: { slug: string; artifacts: readonly ArtifactStripItem[] }) {
  const latest = stripArtifacts(artifacts, new Date());
  return (
    <div data-testid="artifacts-strip">
      {latest.length === 0 ? (
        <p className="border border-surface-border bg-surface p-5 text-muted">No artifacts yet. The first one is the market report.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {latest.map((a) => (
            <li key={a.id} className="border border-surface-border bg-bg" data-testid="artifact-item" data-kind={a.kind}>
              <Link href={`/c/${slug}/artifacts/${a.id}`} className="flex h-full flex-col gap-1 p-4 hover:bg-surface">
                <span className="mono-label text-faint">
                  {artifactKindLabel(a.kind)} · v{a.version}
                </span>
                <span className="font-display text-xl leading-tight">{a.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {artifacts.length > 0 ? (
        <Link href={`/c/${slug}/artifacts`} className="mono-label mt-3 inline-block text-muted hover:text-fg hover:underline">
          All artifacts →
        </Link>
      ) : null}
    </div>
  );
}
