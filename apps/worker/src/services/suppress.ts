// CMP-1: one suppression per address: the unsubscribe route and the bounce/opt-out collector write a row only when none blocks the address yet.
import { addSuppression, listSuppressed, type DbClient, type SuppressionReason } from "@north/db";

/** What `suppressOnce` records: the company, the address, why, and the send that caused it when there is one. */
export interface SuppressOnceInput {
  readonly companyId: string;
  readonly email: string;
  readonly reason: SuppressionReason;
  readonly sourceActionId?: string | null;
}

/**
 * Records that the company must not write to this address again, unless it
 * already must not (`listSuppressed`: the address itself or its domain is
 * listed, or it cannot be looked up safely, which the gate refuses anyway).
 * `suppressions` is append-only: this only ever inserts, and a repeat (a
 * second click, a second bounce) writes nothing and does not throw. Two
 * concurrent first hits may both insert; a repeated row is harmless history.
 * Returns whether a row was written.
 */
export async function suppressOnce(db: DbClient, input: SuppressOnceInput): Promise<boolean> {
  const already = await listSuppressed(db, input.companyId, [input.email]);
  if (already.length > 0) return false;
  await addSuppression(db, { companyId: input.companyId, email: input.email, reason: input.reason, sourceActionId: input.sourceActionId ?? null });
  return true;
}
