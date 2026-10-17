// CMP-1: the in-memory suppressions and sender identity the gate's outreach context reads (M7 additions to the `@north/db` stand-in).
import { vi } from "vitest";
import type { SenderIdentity } from "@north/core";

/**
 * M7 additions to the in-memory `@north/db` stand-in (CMP-1): the company's
 * suppression rows and its sender identity, read by the gate's outreach
 * context. Mixed into `fakeDbModule` by `fake-db.ts`.
 */

export interface FakeSuppression {
  companyId: string;
  /** An address or a bare domain, lower-cased, as migration 0019 stores it. */
  email: string;
  /** Set by `addSuppression` (the gate tests seed rows without it). */
  reason?: string;
  sourceActionId?: string | null;
}

export interface M7State {
  suppressions: FakeSuppression[];
  /**
   * Sender identities by company. A company not in the map has
   * `FAKE_SENDER_IDENTITY` (the fakes model a company that filled it in, so
   * outreach tests from before M7 still reach their card); `null` means none.
   */
  senderIdentities: Map<string, SenderIdentity | null>;
}

export const emptyM7State = (): M7State => ({ suppressions: [], senderIdentities: new Map() });

/** The unsubscribe secret and public URL `fakeDeps` gives a live-mode worker (CMP-1: live mode signs no link without them). */
export const FAKE_LIVE_UNSUBSCRIBE = Object.freeze({ UNSUBSCRIBE_SECRET: "fake-live-unsubscribe-secret", NORTH_WORKER_PUBLIC_URL: "https://worker.north.test" });

export const FAKE_SENDER_IDENTITY: SenderIdentity = Object.freeze({ legalName: "Lumen Labs Ltd", postalAddress: "1 Example Street, Springfield 12345" });

/** The repository's own rule for what the suppression query can carry; anything else comes back suppressed (fail closed). */
const PLAIN_ADDRESS = /^[^\s"\\,()@\p{Cc}]+(?:@[^\s"\\,()@\p{Cc}]+)?$/u;
const isPlainAddress = (address: string): boolean => address.length >= 3 && address.length <= 254 && PLAIN_ADDRESS.test(address);
const domainOf = (address: string): string => (address.includes("@") ? address.slice(address.lastIndexOf("@") + 1) : "");

export function fakeDbM7(state: M7State) {
  return {
    /** `listSuppressed`: every input (normalised, once) suppressed itself or by its domain, and every input that is not a plain address. */
    listSuppressed: vi.fn(async (_db: unknown, companyId: string, emails: readonly string[]): Promise<readonly string[]> => {
      const named = new Set(state.suppressions.filter((s) => s.companyId === companyId).map((s) => s.email));
      const inputs = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
      return inputs.filter((a) => !isPlainAddress(a) || named.has(a) || named.has(domainOf(a)));
    }),
    /** `addSuppression`: appends a row (append-only, repeats allowed, as in 0019) and returns its id. */
    addSuppression: vi.fn(async (_db: unknown, input: { companyId: string; email: string; reason: string; sourceActionId?: string | null }): Promise<string> => {
      state.suppressions.push({ companyId: input.companyId, email: input.email.trim().toLowerCase(), reason: input.reason, sourceActionId: input.sourceActionId ?? null });
      return `suppression-${state.suppressions.length}`;
    }),
    /** `addSuppressionOnce` (0022): nothing when the address or its domain is already listed (null), else one row and its id. */
    addSuppressionOnce: vi.fn(async (_db: unknown, input: { companyId: string; email: string; reason: string; sourceActionId?: string | null }): Promise<string | null> => {
      const email = input.email.trim().toLowerCase();
      const named = new Set(state.suppressions.filter((s) => s.companyId === input.companyId).map((s) => s.email));
      if (named.has(email) || named.has(domainOf(email))) return null;
      state.suppressions.push({ companyId: input.companyId, email, reason: input.reason, sourceActionId: input.sourceActionId ?? null });
      return `suppression-${state.suppressions.length}`;
    }),
    getSenderIdentity: vi.fn(async (_db: unknown, companyId: string): Promise<SenderIdentity | null> => (state.senderIdentities.has(companyId) ? (state.senderIdentities.get(companyId) ?? null) : FAKE_SENDER_IDENTITY)),
  };
}
