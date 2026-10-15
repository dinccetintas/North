"use client";

import { useState, useSyncExternalStore } from "react";
import { installPromptServerSnapshot, installPromptSnapshot, promptInstall, subscribeInstallPrompt } from "@/lib/install-event";

const DISMISSED_KEY = "north-install-dismissed";

type Platform = "standalone" | "ios" | "other";

const noop = () => () => undefined;

function detectPlatform(): Platform {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "standalone";
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "other";
}

const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * PWA-1: a dismissible bar on `/companies`. Chromium: "Install" opens the
 * browser's dialog from the captured `beforeinstallprompt`. iOS Safari has no
 * such event, so the bar names Share → Add to Home Screen. Dismissal is
 * remembered in this browser; an installed app never sees the bar.
 */
export function InstallPrompt() {
  const event = useSyncExternalStore(subscribeInstallPrompt, installPromptSnapshot, installPromptServerSnapshot);
  const platform = useSyncExternalStore(noop, detectPlatform, () => "standalone" as Platform);
  const storedDismissal = useSyncExternalStore(noop, readDismissed, () => true);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || storedDismissal || platform === "standalone") return null;
  if (event === null && platform !== "ios") return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode: the bar stays hidden for this page view only.
    }
    setDismissed(true);
  };

  return (
    <aside
      aria-label="Install North"
      className="mono-label mt-6 flex flex-wrap items-center justify-between gap-3 border border-surface-border bg-surface px-4 py-3"
      data-testid="install-prompt"
      data-platform={event ? "chromium" : platform}
    >
      {event ? (
        <span>Install North on this device: the brief opens like an app and reads offline.</span>
      ) : (
        <span data-testid="install-ios-hint">Install North: tap Share, then Add to Home Screen.</span>
      )}
      <span className="flex items-center gap-3">
        {event ? (
          <button type="button" className="retro-button retro-button-primary" data-testid="install-accept" onClick={() => void promptInstall()}>
            Install
          </button>
        ) : null}
        <button type="button" className="retro-button" data-testid="install-dismiss" onClick={dismiss}>
          Not now
        </button>
      </span>
    </aside>
  );
}
