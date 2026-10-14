"use client";

import { useTransition, useState } from "react";
import { useParams } from "next/navigation";
import { toggleKillSwitchAction } from "@/app/(app)/c/[slug]/actions";

/** "Stop all agents" button: present on every company screen (spec: kill switch NFR). */
export function KillSwitch({ companyId, active }: { companyId: string; active: boolean }) {
  const params = useParams<{ slug: string }>();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
