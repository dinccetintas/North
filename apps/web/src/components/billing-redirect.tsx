"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { billingSessionStateAction, type SessionState } from "@/app/(app)/settings/billing/actions";
import { AsciiSpinner } from "@/components/ascii-spinner";
import type { BillingFailure } from "@/lib/billing-view";
import { errorText } from "@/lib/page-errors";

const POLL_MS = 1_000;
const MAX_MS = 20_000;

type View = SessionState["status"] | "timeout";

/**
 * BIL-1: waits for the worker to create the Stripe session (it holds the
 * key; the web only inserted the request), polling the row once a second for
 * up to 20 s, then leaves for the URL the server already vetted.
 */
export function BillingRedirect({ sessionId, initial }: { sessionId: string; initial: SessionState }) {
  const [view, setView] = useState<View>(initial.status);
  const [reason, setReason] = useState<BillingFailure | null>(initial.reason ?? null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const follow = (state: SessionState): boolean => {
      if (state.status === "ready" && state.url) {
        window.location.assign(state.url);
        return true;
      }
      if (state.status === "failed" || state.status === "missing") {
        setView(state.status);
        setReason(state.reason ?? null);
        return true;
      }
      return false;
    };
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - started > MAX_MS) {
        setView("timeout");
        return;
      }
      const state = await billingSessionStateAction(sessionId).catch(() => ({ status: "requested" as const, url: null }));
      if (!cancelled && !follow(state)) timer = setTimeout(poll, POLL_MS);
    };
    if (!follow(initial)) timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, initial]);

  if (view === "failed" || view === "missing" || view === "timeout") {
    return (
      <div className="mt-8 border border-error bg-error-bg p-5" data-testid="billing-session-failed" data-reason={view} data-failure={reason ?? undefined}>
        <p className="mono-label text-error">
          {view === "timeout" ? "Stripe did not answer in time. Nothing was charged." : reason ? errorText("billing", reason) : "Billing could not start. Nothing was charged."}
        </p>
        <Link href="/settings/billing" className="retro-button mt-4 inline-block">
          Back to billing
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-8 border border-surface-border bg-surface p-5" data-testid="billing-redirecting">
      <AsciiSpinner label={view === "ready" ? "Opening Stripe…" : "Preparing a secure Stripe page…"} />
    </div>
  );
}
