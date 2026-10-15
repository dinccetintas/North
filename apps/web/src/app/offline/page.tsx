import Link from "next/link";
import { OfflineBrief } from "@/components/offline-brief";

export const metadata = { title: "Offline", robots: { index: false, follow: false } };

/**
 * PWA-1: the page the service worker serves when a navigation fails. Static
 * (precached at install); the brief comes from Cache Storage on the client.
 * Cards are never shown here: they need a connection.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <Link href="/companies" className="font-display text-2xl">
          North
        </Link>
        <span className="mono-label text-faint">Offline</span>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6" data-testid="offline-page">
        <h1 className="text-4xl">You are offline.</h1>
        <p className="mono-label mt-3 border border-surface-border bg-surface px-3 py-3 text-muted" data-testid="offline-copy">
          You are offline. This is the latest brief; cards need a connection.
        </p>
        <OfflineBrief />
      </main>
    </div>
  );
}
