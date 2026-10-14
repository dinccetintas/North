"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "@/app/(app)/settings/actions";

type PushState = "checking" | "unsupported" | "off" | "on" | "denied" | "error";

/** VAPID public keys are URL-safe base64; `PushManager.subscribe` wants raw bytes. */
export function applicationServerKey(base64Url: string): Uint8Array {
  const padded = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** What this browser can do right now; async so the effect only sets state from a callback. */
async function detectPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? "on" : "off";
  } catch {
    return "off";
  }
}

const keysOf = (subscription: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null => {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  return json.endpoint && p256dh && auth ? { endpoint: json.endpoint, p256dh, auth } : null;
};

/**
 * "Enable notifications" (DEC-2): registers the service worker, subscribes the
 * browser and stores the subscription. Renders nothing when the server has no
 * VAPID key, so sandbox installs never show a button that cannot work.
 */
export function PushEnable({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<PushState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    void detectPushState().then((detected) => {
      if (!cancelled) setState(detected);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!publicKey) return null;

  const enable = () =>
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState("denied");
          return;
        }
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) as BufferSource });
        const keys = keysOf(subscription);
        if (!keys) throw new Error("The browser returned an incomplete subscription");
        const result = await savePushSubscriptionAction(keys);
        if (!result.ok) throw new Error(result.error);
        setState("on");
        setError(null);
      } catch (cause) {
        setState("error");
        setError(cause instanceof Error ? cause.message : "Could not enable notifications");
      }
    });

  const disable = () =>
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    });

  return (
    <div data-testid="push-enable" data-state={state}>
      {state === "checking" ? <span className="mono-label text-faint">checking…</span> : null}
      {state === "unsupported" ? <span className="mono-label text-faint">This browser cannot receive push notifications.</span> : null}
      {state === "denied" ? <span className="mono-label text-error">Notifications are blocked in this browser&apos;s settings.</span> : null}
      {state === "off" || state === "error" ? (
        <button type="button" onClick={enable} disabled={pending} className="retro-button retro-button-primary">
          {pending ? "…" : "Enable notifications"}
        </button>
      ) : null}
      {state === "on" ? (
        <span className="flex flex-wrap items-center gap-3">
          <span className="mono-label text-success">Push on for this browser</span>
          <button type="button" onClick={disable} disabled={pending} className="retro-button">
            Turn off
          </button>
        </span>
      ) : null}
      {error ? (
        <p className="mono-label mt-3 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
