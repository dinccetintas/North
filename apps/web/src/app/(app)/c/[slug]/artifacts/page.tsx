import Link from "next/link";
import { notFound } from "next/navigation";
import { listArtifacts } from "@north/db";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { roleTitle } from "@/lib/labels";

export const metadata = { title: "Artifacts" };

type Params = Promise<{ slug: string }>;

interface ArtifactItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly version: number;
  readonly createdByRole: string;
  readonly createdAt: string;
}

/** Groups by kind, keeping the newest-first order inside each group and ordering groups by their newest item. */
function groupByKind(artifacts: readonly ArtifactItem[]): ReadonlyArray<readonly [string, readonly ArtifactItem[]]> {
  const sorted = [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups = sorted.reduce<Map<string, ArtifactItem[]>>((acc, a) => {
    const list = acc.get(a.kind) ?? [];
    return new Map(acc).set(a.kind, [...list, a]);
  }, new Map());
  return Array.from(groups.entries());
}

export default async function ArtifactsPage({ params }: { params: Params }) {
  const { slug } = await params;
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const artifacts = await listArtifacts(db, company.id);
  const groups = groupByKind(artifacts);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="mono-label text-faint">{artifacts.length} artifacts</p>
      <h1 className="mt-1 text-4xl">Artifacts</h1>
      <p className="mono-label mt-2 text-faint" data-testid="artifact-formats">
        MD here; PDF and PPTX in your{" "}
        <Link href="/settings/export" className="underline">
          export
        </Link>
      </p>

      {groups.length === 0 ? (
        <p className="mt-8 border border-surface-border bg-surface p-5 text-muted">
          Nothing written yet. The market report is first.
        </p>
      ) : (
        groups.map(([kind, items]) => (
          <section key={kind} className="mt-10">
            <h2 className="mono-label text-faint">{kind.replace(/_/g, " ")}</h2>
            <ul className="mt-3 divide-y divide-surface-border border border-surface-border">
              {items.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/c/${slug}/artifacts/${a.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface"
                    data-testid="artifact-link"
                  >
                    <span className="font-display text-xl">{a.title}</span>
                    <span className="mono-label text-faint">
                      v{a.version} · {roleTitle(a.createdByRole)} · {new Date(a.createdAt).toLocaleDateString("en-GB")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
