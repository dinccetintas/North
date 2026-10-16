// CMP-1: the pure rules that decide whether an outreach email may go out at all: suppressions and a sender identity.
import { z } from "zod";
import { batchPayload, type ActionKind, type ActionSpec } from "../authority/action";

/** Who the founder's company is, in the words the law wants at the foot of every outreach email. */
export const SenderIdentitySchema = z.object({
  legalName: z.string().trim().min(1).max(120),
  postalAddress: z.string().trim().min(8).max(300),
});
export type SenderIdentity = z.infer<typeof SenderIdentitySchema>;

/** What the outreach rules know about the company at the moment of sending. */
export interface OutreachContext {
  /** Addresses and bare domains that must never be written to; the caller normalises them, the rules do it again. */
  readonly suppressed: readonly string[];
  readonly senderIdentity: SenderIdentity | null;
}

export type OutreachRefusal = "suppressed" | "no_sender_identity";

/** The kinds that write to a person; every other kind is outside these rules. */
const OUTREACH_KINDS: ReadonlySet<ActionKind> = new Set(["email.send.first_contact", "email.send.reply"]);

const ANGLE_ADDRESS = /<([^<>]*)>/g;

/**
 * The comparable form of an address: the part in the last angle brackets when
 * there is one (`Ada <Ada@Example.com>`), trimmed and lower-cased. The last
 * pair wins so an address smuggled into the display name cannot stand in for
 * the real one. A bare domain normalises the same way.
 */
export function normaliseEmail(value: string): string {
  const last = [...value.matchAll(ANGLE_ADDRESS)].at(-1);
  return (last?.[1] ?? value).trim().toLowerCase();
}

/** The normalised `payload.to` of a send, or null when it is missing, not a string or blank. */
function toAddress(spec: ActionSpec): string | null {
  const to = spec.payload?.to;
  if (typeof to !== "string") return null;
  const address = normaliseEmail(to);
  return address === "" ? null : address;
}

/**
 * Who an outreach email is written to, normalised: the batch recipient list
 * when the payload carries one, else `payload.to`, else nobody. Empty for
 * every kind that is not an email to a person.
 */
export function recipientsOf(spec: ActionSpec): readonly string[] {
  if (!OUTREACH_KINDS.has(spec.kind)) return Object.freeze([]);
  const listed = batchPayload(spec.payload)?.recipients;
  if (listed) return Object.freeze(listed.map(normaliseEmail));
  const to = toAddress(spec);
  return Object.freeze(to ? [to] : []);
}

/** An address is suppressed when it is listed itself or its domain is. */
function isSuppressed(address: string, suppressed: ReadonlySet<string>): boolean {
  if (suppressed.has(address)) return true;
  const at = address.lastIndexOf("@");
  return at >= 0 && suppressed.has(address.slice(at + 1));
}

/**
 * Why an outreach email must not be sent, or null when it may. A suppressed
 * recipient (address or domain) is refused first, then a company without a
 * sender identity. A batch send's own `to` is checked as well as its recipient
 * list, so a suppressed address cannot ride along behind a clean list. Kinds
 * other than first contact and reply are none of this rule's business.
 */
export function outreachRefusal(spec: ActionSpec, ctx: OutreachContext): OutreachRefusal | null {
  if (!OUTREACH_KINDS.has(spec.kind)) return null;
  const suppressed = new Set(ctx.suppressed.map(normaliseEmail));
  const own = toAddress(spec);
  const targets = own ? [...recipientsOf(spec), own] : recipientsOf(spec);
  if (targets.some((address) => isSuppressed(address, suppressed))) return "suppressed";
  return ctx.senderIdentity === null ? "no_sender_identity" : null;
}
