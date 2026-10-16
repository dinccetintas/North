"use client";

import { useEffect } from "react";
import { clearCachedBriefs } from "@/lib/offline-brief";

/**
 * M6 review L14: on the sign-in page there is no session on this device (the
 * proxy sends a signed-in visitor to /companies), so the briefs kept for
 * offline reading belong to nobody here and are deleted. This also covers a
 * session that ended in a client-side transition, which the service worker
 * does not see as a navigation. Renders nothing.
 */
export function ClearOfflineBriefs() {
  useEffect(() => {
    void clearCachedBriefs().catch(() => undefined);
  }, []);
  return null;
}
