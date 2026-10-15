import type { CreditEntryRow, PackCardView } from "@/lib/billing-view";
import { buyCreditsAction } from "@/app/(app)/settings/billing/actions";
import { SubmitButton } from "@/components/submit-button";

export interface CreditsPanelProps {
  readonly balance: number;
  readonly packs: readonly PackCardView[];
  readonly entries: readonly CreditEntryRow[];
  /** Buying needs a live account: an ended subscription subscribes first. */
  readonly canBuy: boolean;
}

/** BIL-2: one credit is one agent run; the balance is the sum of an append-only ledger. Packs are bought in Stripe and granted by the webhook. */
export function CreditsPanel({ balance, packs, entries, canBuy }: CreditsPanelProps) {
  return (
    <section className="mt-10" data-testid="credits-panel">
      <h2 className="mono-label text-faint">Credits</h2>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border border-surface-border bg-surface p-5">
        <div>
          <p className="font-display text-5xl leading-none">
            <span data-testid="credits-balance">{balance}</span>
          </p>
          <p className="mono-label mt-2 text-faint">credits left · one credit is one agent run</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {packs.map((pack) => (
            <form key={pack.id} action={buyCreditsAction.bind(null, pack.id)}>
              <SubmitButton testId="credits-buy" data-pack-id={pack.id} disabled={!canBuy}>
                Buy {pack.label} · {pack.priceLabel}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>
      {balance <= 0 ? (
        <p className="mono-label mt-3 text-warning" data-testid="credits-exhausted">
          Agents are waiting for credits: queued tasks run again when credits are added.
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className="mt-3 text-muted">No credit movements yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-surface-border border border-surface-border" data-testid="credit-entries">
          {entries.map((e) => (
            <li key={e.id} className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 px-4 py-2" data-testid="credit-entry" data-kind={e.kind}>
              <span className="mono-label text-faint">{e.day}</span>
              <span className="truncate">
                {e.kindLabel}
                {e.note ? <span className="text-muted"> · {e.note}</span> : null}
              </span>
              <span className={`mono-label ${e.amountLabel.startsWith("+") ? "text-success" : "text-muted"}`}>{e.amountLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
