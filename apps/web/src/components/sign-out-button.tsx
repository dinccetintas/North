"use client";

import { clearCachedBriefs } from "@/lib/offline-brief";

/**
 * Sign out; the briefs this browser kept for offline reading are deleted
 * first, by the page and by the service worker (`{ type: "sign-out" }`), so
 * the delete finishes even though the form navigates away at once (PWA-1, M6
 * review L14: nothing of the account stays on a shared device).
 */
export function SignOutButton() {
  return (
    <button type="submit" className="hover:underline" data-testid="sign-out" onClick={() => void clearCachedBriefs().catch(() => undefined)}>
      Sign out
    </button>
  );
}
