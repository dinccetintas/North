import Link from "next/link";
import { listCompanies } from "@north/db";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const supabase = await createClient();
  const companies = await listCompanies(supabase);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-end justify-between">
        <h1 className="text-4xl">Your companies</h1>
        <Link href="/new" className="retro-button retro-button-primary">
          New company
        </Link>
      </div>

      {companies.length === 0 ? (
        <p className="mt-10 border border-surface-border bg-surface p-6 text-muted">
          No company yet. Start one: a thesis, a goal and a budget are all it takes.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-surface-border border border-surface-border">
          {companies.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} className="flex items-center justify-between px-4 py-4 hover:bg-surface">
                <span className="font-display text-2xl">{c.name}</span>
                <span className="mono-label text-faint">{c.killSwitchActive ? "stopped" : c.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
