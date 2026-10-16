import { ActionSpecSchema, batchPayload, type ActionSpec } from "@north/core";
import { listLeads, pendingActionsForCard, type ActionRecord } from "@north/db";
import type { WorkerDeps } from "../deps";

/**
 * M4 review H3: a batch card's scope is the verified lead list, not whatever
 * the agent wrote. A first contact (a batch's first send, or a single send
 * without `batchId`, which is a batch of one) may open a card only when every
 * recipient is a `new` lead of the company; that no other open batch holds
 * one is checked by `openFirstContactCard`, atomically with the card (0017;
 * SLS-K2 / DEC-3: a second card for the same people spends a decision and
 * fails when approved). Every later send of a batch may attach to its card
 * only when its recipient is on the card's list and the card still has room.
 * Anything else is `batch_mismatch`.
 */

export const BATCH_MISMATCH = "batch_mismatch";

/** The refusal when `openFirstContactCard` finds an address held by another open first contact. */
export const heldRefusal = (email: string): string => `${BATCH_MISMATCH}: ${email} is already in an open batch`;

const storedSpec = (a: ActionRecord): ActionSpec | null => {
  const parsed = ActionSpecSchema.safeParse((a.payload as { spec?: unknown }).spec);
  return parsed.success ? parsed.data : null;
};

const recipientOf = (spec: ActionSpec): string => (typeof spec.payload?.to === "string" ? spec.payload.to.trim().toLowerCase() : "");

/** The refusal for a send that wants to attach to an open batch card, or null when it fits the card's scope. */
export async function batchReuseRefusal(deps: WorkerDeps, cardId: string, spec: ActionSpec): Promise<string | null> {
  const pending = await pendingActionsForCard(deps.db, cardId);
  const first = pending[0] ? storedSpec(pending[0]) : null;
  const recipients = first ? batchPayload(first.payload)?.recipients : undefined;
  if (!recipients) return `${BATCH_MISMATCH}: the card carries no recipient list`;
  if (pending.length >= recipients.length) return `${BATCH_MISMATCH}: the card already covers its ${recipients.length} recipients`;
  const to = recipientOf(spec);
  if (!recipients.includes(to)) return `${BATCH_MISMATCH}: ${to || "(no recipient)"} is not on the card's list`;
  return null;
}

/** The addresses a first contact opens a card for: its batch's recipient list, or its own `to`; a string when the shape is refused. */
function recipientsOf(spec: ActionSpec): readonly string[] | string {
  const batch = batchPayload(spec.payload);
  const to = recipientOf(spec);
  if (!batch) return to ? [to] : `${BATCH_MISMATCH}: a first contact needs its recipient`;
  if (!batch.recipients) return `${BATCH_MISMATCH}: a batch needs its recipient list`;
  if (!batch.recipients.includes(to)) return `${BATCH_MISMATCH}: ${to || "(no recipient)"} is not on its own recipient list`;
  return batch.recipients;
}

/**
 * The refusal for a first contact that would open a card (a batch's first
 * send, or a single send), or null when every recipient is a new lead of the
 * company. Only those recipients are looked up (≤ a batch's fifty), never
 * the whole lead list. The gate reaches this only when the task has no open
 * card for the send's batch yet (`reuseCard` runs first). Scope `own` checks
 * only the send's own recipient: an auto-approved send, whose batch's earlier
 * sends have already contacted theirs.
 */
export async function firstContactRefusal(deps: WorkerDeps, companyId: string, spec: ActionSpec, scope: "card" | "own" = "card"): Promise<string | null> {
  const listed = recipientsOf(spec);
  if (typeof listed === "string") return listed;
  const recipients = scope === "own" ? [recipientOf(spec)] : listed;
  const found = await listLeads(deps.db, companyId, { status: ["new"], emails: recipients, limit: recipients.length });
  const leads = new Set(found.map((l) => l.email));
  const stranger = recipients.find((r) => !leads.has(r));
  return stranger ? `${BATCH_MISMATCH}: ${stranger} is not a new lead of this company` : null;
}
