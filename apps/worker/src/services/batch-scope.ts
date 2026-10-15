import { ActionSpecSchema, batchPayload, type ActionSpec } from "@north/core";
import { listLeads, pendingActionsForCard, type ActionRecord } from "@north/db";
import type { WorkerDeps } from "../deps";

/**
 * M4 review H3: a batch card's scope is the verified lead list, not whatever
 * the agent wrote. The first send of a batch may open a card only when every
 * recipient it lists is a `new` lead of the company; every later send may
 * attach to that card only when its recipient is on the card's list and the
 * card still has room. Anything else is `batch_mismatch`.
 */

export const BATCH_MISMATCH = "batch_mismatch";

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

/** The refusal for the first send of a batch (the one that opens the card), or null when every recipient is a new lead of the company. */
export async function batchOpenRefusal(deps: WorkerDeps, companyId: string, spec: ActionSpec): Promise<string | null> {
  const batch = batchPayload(spec.payload);
  if (!batch) return null;
  if (!batch.recipients) return `${BATCH_MISMATCH}: a batch needs its recipient list`;
  const to = recipientOf(spec);
  if (!batch.recipients.includes(to)) return `${BATCH_MISMATCH}: ${to || "(no recipient)"} is not on its own recipient list`;
  const leads = new Set((await listLeads(deps.db, companyId, { status: ["new"] })).map((l) => l.email));
  const stranger = batch.recipients.find((r) => !leads.has(r));
  return stranger ? `${BATCH_MISMATCH}: ${stranger} is not a new lead of this company` : null;
}
