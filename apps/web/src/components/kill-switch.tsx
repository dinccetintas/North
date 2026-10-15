"use client";

import Link from "next/link";
import { useTransition, useState } from "react";
import { useParams } from "next/navigation";
import { toggleKillSwitchAction } from "@/app/(app)/c/[slug]/actions";

export interface KillSwitchProps {
  readonly companyId: string;
  readonly active: boolean;
  /** Who set the switch (ADR 0014): `user` resumes here; `subscription_ended` and `retention` belong to billing. */
  readonly pausedReason?: string | null;
}

/** Billing paused the agents: the bar says so and points at billing; there is no resume button to press. */
function BillingPause({ reason }: { reason: "subscription_ended" | "retention" }) {
  if (reason === "retention") {
    return (
      <span className="mono-label border border-surface-border px-3 py-1.5 text-faint" data-testid="kill-switch-archived">
        Archived
      </span>
    );
  }
  return (
    <span className="mono-label flex flex-wrap items-center gap-3" data-testid="kill-switch-subscription">
      <span className="text-error">Paused: subscription ended</span>
      <Link href="/settings/billing" className="retro-button retro-button-primary" data-testid="kill-switch-billing">
        Subscribe to resume
      </Link>
    </span>
  );
}

/** "Stop all agents" button: present on every company screen (spec: kill switch NFR). */
export function KillSwitch({ companyId, active, pausedReason = null }: KillSwitchProps) {
  const params = useParams<{ slug: string }>();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (active && (pausedReason === "subscription_ended" || pausedReason === "retention")) return <BillingPause reason={pausedReason} />;

  const onClick = () =>
    startTransition(async () => {
      const result = await toggleKillSwitchAction({ companyId, active: !active, slug: params.slug });
      setError(result.ok ? null : result.error);
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        data-testid="kill-switch"
        aria-pressed={active}
        className={active ? "retro-button bg-success-bg text-success" : "retro-button border-error text-error"}
      >
        {pending ? "…" : active ? "Resume agents" : "Stop all agents"}
      </button>
      {error ? <span className="mono-label text-error">{error}</span> : null}
    </div>
  );
}
