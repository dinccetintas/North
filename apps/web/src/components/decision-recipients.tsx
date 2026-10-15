export interface RecipientRowData {
  readonly id: string;
  /** The address the email goes to; "—" when the row no longer carries it (a settled action). */
  readonly to: string;
  readonly subject: string | null;
  readonly status: string;
  /** The provider's message id once sent. */
  readonly ref: string | null;
}

const STATUS_CLASS: Readonly<Record<string, string>> = Object.freeze({
  pending: "text-warning",
  executed: "text-success",
  declined: "text-faint",
  failed: "text-error",
});

/**
 * SLS-K2: one card per outreach batch, one action per email. The CEO sees
 * every recipient before answering; after the answer each row shows its own
 * message id, the evidence of that one send.
 */
export function DecisionRecipients({ rows }: { rows: readonly RecipientRowData[] }) {
  return (
    <section className="mt-10">
      <h2 className="mono-label text-faint">Recipients · {rows.length}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">No email is attached to this card.</p>
      ) : (
        <ul className="mt-3 divide-y divide-surface-border border border-surface-border" data-testid="decision-recipients">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-baseline" data-testid="decision-recipient" data-status={row.status}>
              <div className="min-w-0">
                <p className="truncate">{row.to}</p>
                {row.subject ? <p className="truncate text-muted">{row.subject}</p> : null}
              </div>
              <p className={`mono-label ${STATUS_CLASS[row.status] ?? "text-faint"}`}>
                {row.status}
                {row.ref ? ` · ${row.ref}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
