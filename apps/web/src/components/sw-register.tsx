"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "@/lib/install-event";

/**
 * PWA-1: registers `/sw.js` on every page (not only after enabling push) so
 * the offline page and the latest brief are there when the network is not,
 * and captures Chromium's install event for the install bar. Renders nothing.
 */
export function SwRegister() {
  useEffect(() => {
    const release = captureInstallPrompt();
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
        console.warn("[north] service worker registration failed", error);
      });
    }
    return release;
  }, []);
  return null;
}
