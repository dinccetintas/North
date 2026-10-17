"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveSenderIdentity } from "@/app/(app)/c/[slug]/actions";

/** The same bounds as core's `SenderIdentitySchema`; the server action is the check, these only stop typing past them. */
const LEGAL_NAME_MAX = 120;
const POSTAL_ADDRESS_MAX = 300;
const inputClass = "hairline bg-bg px-3 py-3 outline-none focus:border-deep";

const SENDER_IDENTITY_LINE ="Every first-contact email carries this, as the law requires.";
const UNREACHABLE = "Could not reach the server. Try again in a minute.";

export interface SenderIdentityValue {
  readonly legalName: string;
  readonly postalAddress: string;
}

export interface SenderIdentityFormProps {
  readonly companyId: string;
  readonly slug: string;
  /** The saved identity (`getSenderIdentity`), or null while the company has none. */
  readonly identity: SenderIdentityValue | null;
}

/** The saved identity as the founder reads it, with the line that says why it is there. */
function SavedIdentity({ identity, onChange }: { identity: SenderIdentityValue; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="sender-identity-saved">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="mono-label text-faint">Legal name</dt>
        <dd data-testid="sender-identity-legal-name">{identity.legalName}</dd>
        <dt className="mono-label text-faint">Postal address</dt>
        <dd className="whitespace-pre-line" data-testid="sender-identity-postal-address">
          {identity.postalAddress}
        </dd>
      </dl>
      <p className="text-muted">{SENDER_IDENTITY_LINE}</p>
      <div>
        <button type="button" className="retro-button" onClick={onChange} data-testid="sender-identity-change">
          Change
        </button>
      </div>
    </div>
  );
}

/** The two inputs, prefilled with the saved identity when there is one. */
function IdentityFields({ identity, disabled }: { identity: SenderIdentityValue | null; disabled: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor="legal-name" className="mono-label">
          Legal name
        </label>
        <input id="legal-name" name="legalName" maxLength={LEGAL_NAME_MAX} defaultValue={identity?.legalName ?? ""} disabled={disabled} className={inputClass} data-testid="legal-name" />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="postal-address" className="mono-label">
          Postal address
        </label>
        <textarea id="postal-address" name="postalAddress" rows={3} maxLength={POSTAL_ADDRESS_MAX} defaultValue={identity?.postalAddress ?? ""} disabled={disabled} className={inputClass} data-testid="postal-address" />
      </div>
    </>
  );
}

/**
 * CMP-1 (M7): the company's sender identity, the legal name and postal
 * address the law wants at the foot of every first-contact email. Until it
 * is saved the gate blocks every first contact (`no_sender_identity`). The
 * form calls `saveSenderIdentity`, which validates with core's schema and
 * writes under RLS; a refusal shows the action's fixed line inline.
 */
export function SenderIdentityForm({ companyId, slug, identity }: SenderIdentityFormProps) {
  const [justSaved, setJustSaved] = useState<SenderIdentityValue | null>(null);
  const [editing, setEditing] = useState(identity === null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = justSaved ?? identity;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { companyId, slug, legalName: String(data.get("legalName") ?? ""), postalAddress: String(data.get("postalAddress") ?? "") };
    startTransition(async () => {
      const result = await saveSenderIdentity(input).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (!result.ok) return setError(result.error);
      setError(null);
      setJustSaved({ legalName: input.legalName.trim(), postalAddress: input.postalAddress.trim() });
      setEditing(false);
    });
  };

  const cancel = () => {
    setError(null);
    setEditing(false);
  };

  if (current && !editing) return <SavedIdentity identity={current} onChange={() => setEditing(true)} />;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="sender-identity-form" noValidate>
      <IdentityFields identity={current} disabled={pending} />
      {error ? (
        <p className="mono-label text-error" role="alert" data-testid="sender-identity-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="retro-button retro-button-primary" disabled={pending} data-testid="sender-identity-save">
          {pending ? "…" : "Save"}
        </button>
        {current ? (
          <button type="button" className="retro-button" disabled={pending} onClick={cancel} data-testid="sender-identity-cancel">
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
