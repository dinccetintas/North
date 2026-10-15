"use client";

import { useState, useTransition } from "react";
import { connectSandboxAction, disconnectAction } from "@/app/(app)/settings/connections/actions";

export interface ConnectionRowData {
  readonly provider: "github" | "vercel";
  readonly title: string;
  readonly purpose: string;
  readonly status: "connected" | "revoked" | "error" | "none";
  readonly accountLabel: string;
  readonly connectedAt: string | null;
  /** True when the provider's client id is configured and the real OAuth flow applies. */
  readonly oauth: boolean;
  /** True right after the OAuth callback, until the worker has stored the token. */
  readonly pending: boolean;
}

const STATUS_CLASS: Readonly<Record<ConnectionRowData["status"], string>> = Object.freeze({
  connected: "text-success",
  revoked: "text-faint",
  error: "text-error",
  none: "text-faint",
});

const STATUS_LABEL: Readonly<Record<ConnectionRowData["status"], string>> = Object.freeze({
  connected: "connected",
  revoked: "disconnected",
  error: "error",
  none: "not connected",
});

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** One provider: status, account, and the one button that applies (Connect, Connect (sandbox) or Disconnect). */
export function ConnectionRow({ row }: { row: ConnectionRowData }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : (result.error ?? "Something went wrong"));
    });

  const status = row.pending && row.status !== "connected" ? "finishing…" : STATUS_LABEL[row.status];

  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-4 sm:grid-cols-[8rem_1fr_auto] sm:items-center" data-testid="connection-row" data-provider={row.provider} data-status={row.status}>
      <div>
        <p className="font-display text-xl leading-tight">{row.title}</p>
        <p className={`mono-label ${STATUS_CLASS[row.status]}`} data-testid="connection-status">
          {status}
        </p>
      </div>
      <div className="text-muted">
        <p>{row.purpose}</p>
        {row.status === "connected" ? (
          <p className="mono-label mt-1 text-faint" data-testid="connection-account">
            {row.accountLabel || "account"}
            {row.connectedAt ? ` · since ${formatDate(row.connectedAt)}` : ""}
          </p>
        ) : null}
        {error ? (
          <p className="mono-label mt-1 text-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-start sm:justify-end">
        {row.status === "connected" ? (
          <button type="button" className="retro-button" disabled={pending} onClick={() => run(() => disconnectAction({ provider: row.provider }))} data-testid="connection-disconnect">
            Disconnect
          </button>
        ) : row.oauth ? (
          <a className="retro-button retro-button-primary inline-block" href={`/api/connections/${row.provider}/start`} data-testid="connection-connect">
            Connect {row.title}
          </a>
        ) : (
          <button type="button" className="retro-button retro-button-primary" disabled={pending} onClick={() => run(() => connectSandboxAction({ provider: row.provider }))} data-testid="connection-connect">
            Connect (sandbox)
          </button>
        )}
      </div>
    </li>
  );
}
