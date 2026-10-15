/**
 * PWA-1: Chromium's `beforeinstallprompt` fires once per page load, often
 * before the install bar mounts; `SwRegister` (root layout) captures it here
 * and `InstallPrompt` reads it through `useSyncExternalStore`. Browser only.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice?: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

const isPromptEvent = (event: Event): event is InstallPromptEvent => typeof (event as Partial<InstallPromptEvent>).prompt === "function";

/** Starts listening; returns the cleanup. The browser's own mini-infobar is suppressed in favour of the bar. */
export function captureInstallPrompt(): () => void {
  const onPrompt = (event: Event) => {
    if (!isPromptEvent(event)) return;
    event.preventDefault();
    deferred = event;
    notify();
  };
  const onInstalled = () => {
    deferred = null;
    notify();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const installPromptSnapshot = (): InstallPromptEvent | null => deferred;
export const installPromptServerSnapshot = (): InstallPromptEvent | null => null;

/** Shows the browser's install dialog once; the event cannot be reused after. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  notify();
  await event.prompt();
  const choice = await (event.userChoice ?? Promise.resolve({ outcome: "dismissed" as const }));
  return choice.outcome;
}
