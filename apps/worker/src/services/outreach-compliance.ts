// CMP-1: what every outreach email carries on the wire: the sender's footer, a signed List-Unsubscribe, and copies only as plain addresses.
import { complianceFooter, recipientsOf, signUnsubscribeToken, singleAddress, UNREADABLE_RECIPIENT, type ActionSpec, type SenderIdentity } from "@north/core";
import { getSenderIdentity } from "@north/db";
import { MAX_COPIES, SANDBOX_OUTREACH_MAILBOX, type ListUnsubscribe, type ProviderAuth } from "@north/integrations";
import type { DepsEnv, WorkerDeps } from "../deps";
import { unsubscribeSecretFor } from "../env";

/** The gate blocks a send without a sender identity; this is the belt at perform time (no footer, no send). */
export class SenderIdentityRequiredError extends Error {
  constructor(kind: string) {
    super(`${kind} refused: the company has no sender identity (legal name and postal address) for the compliance footer (CMP-1)`);
    this.name = "SenderIdentityRequiredError";
  }
}

/** No unsubscribe secret resolves (live mode without `UNSUBSCRIBE_SECRET`): no link can be signed, so nothing is sent. The gate does not know the secret. */
export class UnsubscribeSecretRequiredError extends Error {
  constructor(kind: string) {
    super(`${kind} refused: UNSUBSCRIBE_SECRET is not set, so no unsubscribe link can be signed (CMP-1)`);
    this.name = "UnsubscribeSecretRequiredError";
  }
}

/** What a send's compliance parts are built from, read before the connection is touched or the lead claimed. */
export interface ComplianceBasis {
  readonly identity: SenderIdentity;
  readonly secret: string;
  /** `NORTH_WORKER_PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string;
}

/** The footer and `List-Unsubscribe` of one send. */
export interface WireCompliance {
  readonly footer: string;
  readonly unsubscribe: ListUnsubscribe;
}

/** The secret and public URL unsubscribe links need; throws when either is missing (the secret first). */
export function unsubscribeConfigFor(env: DepsEnv, kind: string): { readonly secret: string; readonly publicUrl: string } {
  const secret = unsubscribeSecretFor(env);
  if (!secret) throw new UnsubscribeSecretRequiredError(kind);
  if (!env.NORTH_WORKER_PUBLIC_URL) throw new Error(`${kind} refused: NORTH_WORKER_PUBLIC_URL is not set, so unsubscribe links have nowhere to point (CMP-1)`);
  return Object.freeze({ secret, publicUrl: env.NORTH_WORKER_PUBLIC_URL.replace(/\/+$/, "") });
}

/** The sender identity and the unsubscribe configuration, or the error that stops the send. */
export async function complianceBasisFor(deps: WorkerDeps, action: ActionSpec): Promise<ComplianceBasis> {
  const config = unsubscribeConfigFor(deps.env, action.kind);
  const identity = await getSenderIdentity(deps.db, action.companyId);
  if (!identity) throw new SenderIdentityRequiredError(action.kind);
  return Object.freeze({ identity, ...config });
}

/** The mailbox the email leaves from, as a plain address: the Gmail connection's account in live mode, the sandbox mailbox in sandbox mode. */
export function mailboxOf(auth: ProviderAuth | null, mode: WorkerDeps["integrations"]["mode"], kind: string): string {
  if (mode === "sandbox") return SANDBOX_OUTREACH_MAILBOX;
  const address = auth?.account ? singleAddress(auth.account) : null;
  if (!address) throw new Error(`${kind} refused: the connected mailbox has no readable address for List-Unsubscribe (reconnect Gmail)`);
  return address;
}

/**
 * The footer (`complianceFooter`, always appended by the adapter) and the
 * `List-Unsubscribe` targets for one recipient of one company: the mailbox's
 * `mailto` and `<NORTH_WORKER_PUBLIC_URL>/u/<token>`, the token signed for
 * `{ companyId, email }` (the email normalised by the signer).
 */
export function wireCompliance(basis: ComplianceBasis, companyId: string, recipient: string, mailbox: string): WireCompliance {
  const url = `${basis.publicUrl}/u/${signUnsubscribeToken({ companyId, email: recipient }, basis.secret)}`;
  return Object.freeze({ footer: complianceFooter(basis.identity, url), unsubscribe: Object.freeze({ mailto: `${mailbox}?subject=unsubscribe`, url }) });
}

/** One copy key of the payload read the way the gate read it (core's `recipientsOf` on that key alone); refuses anything unreadable. */
function copyList(action: ActionSpec, key: "cc" | "bcc"): readonly string[] | undefined {
  const value = action.payload?.[key];
  if (value === undefined || value === null) return undefined;
  const entries = recipientsOf({ ...action, payload: { [key]: value } });
  if (entries.includes(UNREADABLE_RECIPIENT) || entries.length > MAX_COPIES) throw new Error(`${action.kind} refused: payload.${key} must be at most ${MAX_COPIES} plain addresses`);
  return entries.length > 0 ? Object.freeze([...entries]) : undefined;
}

/** `cc` and `bcc` from those payload keys only, as arrays of normalised plain addresses; absent when empty. Nothing else of the payload reaches the headers. */
export function copiesOf(action: ActionSpec): { readonly cc?: readonly string[]; readonly bcc?: readonly string[] } {
  const cc = copyList(action, "cc");
  const bcc = copyList(action, "bcc");
  return Object.freeze({ ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}) });
}
