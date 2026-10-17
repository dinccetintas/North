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
    getSenderIdentity: vi.fn(async (_db: unknown, companyId: string): Promise<SenderIdentity | null> => (state.senderIdentities.has(companyId) ? (state.senderIdentities.get(companyId) ?? null) : FAKE_SENDER_IDENTITY)),
  };
}
