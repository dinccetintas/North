"use client";

import { useEffect } from "react";
import type { BriefView } from "@/lib/brief-view";

/**
 * PWA-1: hands the brief this page rendered to the service worker, which
 * keeps the latest one per company in `north-brief-v1` for `/offline`, keyed
 * by the signed-in user (M6 review L14: another user's brief replaces the
 * cache, `/offline` shows only the last user's). Only the brief: cards are
 * never cached, so none can be answered from a stale copy.
 */
export function OfflineBriefCache({ userId, slug, brief }: { userId: string; slug: string; brief: BriefView }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((registration) => {
        if (!cancelled) registration.active?.postMessage({ type: "brief", userId, slug, brief });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, slug, brief]);
  return null;
}
