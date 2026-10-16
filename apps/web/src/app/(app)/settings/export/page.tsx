import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ownerCompanies, ownerEntitlement } from "@/lib/account";
import { loadExports, loadRepoRefs } from "@/lib/export-data";
import { exportAccess, exportRows, repoLinks } from "@/lib/export-view";
import { ExportRequestForm, ExportRows, RepoList } from "@/components/export-sections";
import { LiveRefresh } from "@/components/live-refresh";
import { errorText } from "@/lib/page-errors";

export const metadata = { title: "Export" };

type SearchParams = Promise<{ requested?: string; error?: string }>;

/**
 * EXP-1 / MEM-2 / RET-1: request a zip of artifacts (MD, PDF, PPTX) and data
 * (JSON, CSV), download it while it lives, and see where the code already is.
 * Works after a subscription ends until the retention date; then "archived".
 */
export default async function ExportPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([currentUser(), searchParams]);
  if (!user) redirect("/login");
  const db = await createClient();
  const [companies, entitlement] = await Promise.all([ownerCompanies(), ownerEntitlement(user.id)]);
  const [records, repos] = await Promise.all([loadExports(db, user.id), loadRepoRefs(db, companies)]);
  const now = new Date();
  const rows = exportRows(records, new Map(companies.map((c) => [c.id, c.name])), now);
  const building = rows.some((r) => r.status === "requested" || r.status === "running");
  const access = exportAccess(entitlement, now);
  const error = errorText("export", params.error);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/settings" className="mono-label text-faint hover:underline">
            ← Settings
          </Link>
          <h1 className="mt-1 text-4xl">Export</h1>
        </div>
        <LiveRefresh active={building} />
      </div>

      {error ? (
        <p className="mono-label mt-6 border border-error bg-error-bg px-3 py-3 text-error" role="alert" data-testid="export-error">
          {error}
        </p>
      ) : null}
      {params.requested ? (
        <p className="mono-label mt-6 border border-success bg-success-bg px-3 py-3 text-success" data-testid="export-requested">
          Requested. The zip appears below when it is ready.
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="mono-label text-faint">New export</h2>
        {access === "archived" ? (
          <p className="mt-3 border border-surface-border bg-surface p-5 text-muted" data-testid="export-archived">
            Your data is archived: the 90 days after your subscription ended have passed. Write to support to recover it before it is deleted.
          </p>
        ) : (
          <ExportRequestForm companies={companies} />
        )}
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Exports</h2>
        <ExportRows rows={rows} />
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Code</h2>
        <RepoList repos={repoLinks(repos)} />
      </section>
    </main>
  );
}
