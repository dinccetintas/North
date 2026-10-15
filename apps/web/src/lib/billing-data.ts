import { creditBalance, getBillingSession, getEntitlement, getUsage, listCreditEntries, type DbClient } from "@north/db";
import type { Entitlement } from "@north/core/billing/entitlements";
import { localMonth } from "@north/core/time";
import { checkoutConfirmed, type CreditEntryLike } from "./billing-view";
import type { UsageLike } from "./usage-view";

/**
 * Every BIL-1 / BIL-2 read the web makes against the WP-A6 repositories, as
 * the owner (RLS: owners select their entitlement, credit entries, usage and
 * billing sessions; they write nothing but a `requested` session).
 *
 * Repositories used (packages/db, WP-A6): `getEntitlement(db, userId)` →
 * `Entitlement | null`; `creditBalance(db, userId)` → number (the SQL
 * function); `listCreditEntries(db, userId, { limit })` → newest first;
 * `getUsage(db, userId, period)` → `Usage | null`; `getBillingSession(db, id)`
 * → `{ id, kind, status, planId, packId, url, providerRef } | null`.
 */

export const CREDIT_ENTRIES_SHOWN = 20;
/** The pack grant of a just-completed checkout is among the newest rows. */
const CONFIRM_SCAN = 50;

export interface BillingPageData {
  readonly entitlement: Entitlement | null;
  readonly balance: number;
  readonly entries: readonly CreditEntryLike[];
  readonly usage: UsageLike | null;
  /** The owner-local month the usage row is for (`YYYY-MM`). */
  readonly period: string;
}

export async function loadBillingPage(db: DbClient, userId: string, timezone: string, now: Date): Promise<BillingPageData> {
  const period = localMonth(timezone, now);
  const [entitlement, balance, entries, usage] = await Promise.all([
    getEntitlement(db, userId),
    creditBalance(db, userId),
    listCreditEntries(db, userId, { limit: CREDIT_ENTRIES_SHOWN }),
    getUsage(db, userId, period),
  ]);
  return Object.freeze({ entitlement, balance, entries, usage, period });
}

/** The balance and entitlement alone (settings summary, the company home's dispatch line). */
export async function loadPlanSnapshot(db: DbClient, userId: string): Promise<{ readonly entitlement: Entitlement | null; readonly balance: number }> {
  const [entitlement, balance] = await Promise.all([getEntitlement(db, userId), creditBalance(db, userId)]);
  return Object.freeze({ entitlement, balance });
}

/** ADR 0014: the success redirect proves nothing; this reads what only the webhook changes. */
export async function loadCheckoutState(db: DbClient, userId: string, sessionId: string | null): Promise<{ readonly confirmed: boolean }> {
  const [session, entitlement, entries] = await Promise.all([
    sessionId ? getBillingSession(db, sessionId) : Promise.resolve(null),
    getEntitlement(db, userId),
    listCreditEntries(db, userId, { limit: CONFIRM_SCAN }),
  ]);
  const known = session ? { kind: session.kind, planId: session.planId ?? null, providerRef: session.providerRef ?? null } : null;
  return Object.freeze({ confirmed: checkoutConfirmed(known, entitlement, entries.map((e) => e.ref)) });
}
