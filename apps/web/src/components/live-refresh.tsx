"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 5_000;

/** Re-renders the server page every 5 s while agents are working, so task rows update without a reload. */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, router]);

  if (!active) return null;
  return (
    <span className="mono-label cursor-blink text-faint" data-testid="live-refresh" aria-live="polite">
      live
    </span>
  );
}
