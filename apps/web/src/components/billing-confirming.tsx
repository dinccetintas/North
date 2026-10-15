"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkoutStateAction } from "@/app/(app)/settings/billing/actions";
import { AsciiSpinner } from "@/components/ascii-spinner";

const POLL_MS = 1_000;
const MAX_MS = 30_000;

/**
 * BIL-1 (ADR 0014): back from Stripe, the redirect proves nothing. The page
 * says "Confirming with Stripe" and polls what only the webhook changes; once
 * it has, the server page re-renders with the new plan and balance.
 */
export function BillingConfirming({ sessionId, confirmed: initiallyConfirmed }: { sessionId: string | null; confirmed: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"confirming" | "confirmed" | "slow">(initiallyConfirmed ? "confirmed" : "confirming");

  useEffect(() => {
    if (initiallyConfirmed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const poll = async () => {
      if (cancelled) return;
      const { confirmed } = await checkoutStateAction(sessionId).catch(() => ({ confirmed: false }));
      if (cancelled) return;
      if (confirmed) {
        setState("confirmed");
        router.refresh();
        return;
      }
      if (Date.now() - started > MAX_MS) {
        setState("slow");
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, initiallyConfirmed, router]);

  if (state === "confirmed") {
    return (
      <p className="mono-label mt-6 border border-success bg-success-bg px-3 py-3 text-success" data-testid="billing-confirmed">
        Confirmed by Stripe. Your plan and credits below are up to date.
      </p>
    );
  }
  if (state === "slow") {
    return (
      <p className="mono-label mt-6 border border-warning bg-warning-bg px-3 py-3 text-ink" data-testid="billing-confirm-slow">
        Stripe has not confirmed yet. Reload in a minute: your plan changes only when Stripe&apos;s confirmation arrives.
      </p>
    );
  }
  return (
    <div className="mt-6 border border-surface-border bg-surface px-3 py-3" data-testid="billing-confirming">
      <AsciiSpinner label="Confirming with Stripe" />
    </div>
  );
}
