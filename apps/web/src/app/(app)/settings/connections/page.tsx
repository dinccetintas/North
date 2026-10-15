import Link from "next/link";
import { redirect } from "next/navigation";
import { listConnections } from "@north/db";
import { PROVIDER_TITLES } from "@north/core/connections";
import { createClient, currentUser } from "@/lib/supabase/server";
import { oauthConfig, OAUTH_PROVIDERS, type OauthProvider } from "@/lib/oauth";
import { ConnectionRow, type ConnectionRowData } from "@/components/connection-row";

export const metadata = { title: "Connections" };

type SearchParams = Promise<{ pending?: string; error?: string }>;

const PURPOSES: Readonly<Record<OauthProvider, string>> = Object.freeze({
  github: "Engineering pushes the website's code to a repository in your account.",
  vercel: "Previews and the live site deploy to your Vercel account; nothing goes live without your card.",
});

/** Fixed error texts keyed by the callback's error code; anything else shows the generic line. */
const ERRORS: Readonly<Record<string, string>> = Object.freeze({
  "github-state": "The GitHub sign-in did not come back from this browser. Try again.",
  "vercel-state": "The Vercel install did not come back from this browser. Try again.",
  "github-denied": "GitHub did not return a code; the authorisation was cancelled.",
  "vercel-denied": "Vercel did not return a code; the install was cancelled.",
  "github-worker": "GitHub answered, but the agents could not be reached to store the token. Try again in a minute.",
  "vercel-worker": "Vercel answered, but the agents could not be reached to store the token. Try again in a minute.",
  "github-not-configured": "GitHub OAuth is not configured on this deployment.",
  "vercel-not-configured": "The Vercel integration is not configured on this deployment.",
});

/**
 * ONB-3: one row per provider with status, account and date. Connect starts
 * the OAuth flow (or records a sandbox connection when no client id is set);
 * Disconnect revokes and asks the worker to drop the token.
 */
export default async function ConnectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, { pending, error }] = await Promise.all([currentUser(), searchParams]);
  if (!user) redirect("/login");
  const db = await createClient();
  const connections = await listConnections(db, user.id);

  const rows: ConnectionRowData[] = OAUTH_PROVIDERS.map((provider) => {
    const record = connections.find((c) => c.provider === provider) ?? null;
    return {
      provider,
      title: PROVIDER_TITLES[provider],
      purpose: PURPOSES[provider],
      status: record?.status ?? "none",
      accountLabel: record?.accountLabel ?? "",
      connectedAt: record?.status === "connected" ? record.updatedAt : null,
      oauth: oauthConfig(provider) !== null,
      pending: pending === provider,
    };
  });
  const errorText = error ? (ERRORS[error] ?? "Something went wrong; nothing was changed.") : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/settings" className="mono-label text-faint hover:text-fg hover:underline">
        ← Settings
      </Link>
      <h1 className="mt-4 text-4xl">Connections</h1>
      <p className="mt-3 text-muted">
        Agents act only through accounts you own. Tokens are encrypted and read by the agents alone; you can disconnect at any time. Nothing live runs without a connection.
      </p>

      {errorText ? (
        <p className="mono-label mt-6 border border-error bg-error-bg px-3 py-3 text-error" role="alert" data-testid="connections-error">
          {errorText}
        </p>
      ) : null}
      {pending && rows.some((r) => r.provider === pending && r.status !== "connected") ? (
        <p className="mono-label mt-6 border border-surface-border bg-surface px-3 py-3 text-muted" role="status" data-testid="connections-pending">
          Finishing the {PROVIDER_TITLES[pending as OauthProvider] ?? pending} connection… reload in a few seconds.
        </p>
      ) : null}

      <ul className="mt-8 divide-y divide-surface-border border border-surface-border" data-testid="connections">
        {rows.map((row) => (
          <ConnectionRow key={row.provider} row={row} />
        ))}
      </ul>
    </main>
  );
}
