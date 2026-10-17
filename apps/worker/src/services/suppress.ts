// CMP-1: one suppression per address: the unsubscribe route and the bounce/opt-out collector write a row only when none blocks the address yet.
import { addSuppressionOnce, type DbClient, type SuppressionReason } from "@north/db";

/** What `suppressOnce` records: the company, the address, why, and the send that caused it when there is one. */
export interface SuppressOnceInput {
  readonly companyId: string;
  readonly email: string;
  readonly reason: SuppressionReason;
  readonly sourceActionId?: string | null;
}

/**
 * Records that the company must not write to this address again, unless it
 * already must not (the address itself or its bare domain is listed).
 * `addSuppressionOnce` (0022) checks and inserts in one call serialised per
 * address, so a repeat (a second click, a second bounce), concurrent first
 * hits included, writes nothing and does not throw. `suppressions` is
 * append-only: this only ever inserts. Returns whether a row was written.
 */
export async function suppressOnce(db: DbClient, input: SuppressOnceInput): Promise<boolean> {
  const id = await addSuppressionOnce(db, { companyId: input.companyId, email: input.email, reason: input.reason, sourceActionId: input.sourceActionId ?? null });
  return id !== null;
}
