// CMP-1: the pure rules that decide whether an outreach email may go out at all: suppressions and a sender identity.
import { z } from "zod";
import type { ActionKind, ActionSpec } from "../authority/action";

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

/** The kinds that write to a person; every other kind is outside the refusal rules. */
const OUTREACH_KINDS: ReadonlySet<ActionKind> = new Set(["email.send.first_contact", "email.send.reply"]);

/**
 * Stands in for a recipient the rules could not read as exactly one address.
 * It contains no `@`, so it never passes for an address: every consumer that
 * checks recipients one by one refuses or blocks it.
 */
export const UNREADABLE_RECIPIENT = "(unreadable recipient)";

/** A recipient string longer than this is not an address list but an attack on the parser. */
const MAX_RECIPIENT_TEXT = 4096;

/** Cuts a string into quoted strings, `<...>` groups and single characters (so `,` and `;` come out on their own). */
const TOKEN = /"(?:\\.|[^"\\])*"|<[^<>]*>|[\s\S]/g;
const GROUP = /^<[^<>]*>$/;
const QUOTED = /^"[\s\S]*"$/;
const PLAIN_ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+$/;

/**
 * The comparable form of one address: the content of the angle brackets when
 * there is a pair outside any quoted display name (`Ada <Ada@Example.com>`),
 * else the whole value; trimmed and lower-cased. With several pairs the last
 * wins, and an address inside a quoted display name is never the one picked.
 * A bare domain normalises the same way. A list of addresses is not split
 * here: see {@link singleAddress} and {@link recipientsOf}.
 */
export function normaliseEmail(value: string): string {
  const last = (value.match(TOKEN) ?? []).filter((token) => GROUP.test(token)).at(-1);
  return (last ? last.slice(1, -1) : value).trim().toLowerCase();
}

/** The address of one list element, or {@link UNREADABLE_RECIPIENT} when it is not exactly one plain address. */
function readPart(part: string): string {
  const tokens = part.match(TOKEN) ?? [];
  const groups = tokens.filter((token) => GROUP.test(token)).length;
  const loose = tokens.filter((token) => !GROUP.test(token) && !QUOTED.test(token)).join("");
  // Unquoted text may be a display name, but not a bracket, a quote or a second address.
  const wellFormed = groups <= 1 && !/[<>"]/.test(loose) && (groups === 0 || !loose.includes("@"));
  const address = normaliseEmail(part);
  return wellFormed && PLAIN_ADDRESS.test(address) ? address : UNREADABLE_RECIPIENT;
}

/**
 * One entry per element of a recipient string, split on `,` and `;` outside
 * quotes and angle brackets; blank elements are dropped. Each entry is a
 * normalised address or {@link UNREADABLE_RECIPIENT}.
 */
function splitRecipients(value: string): string[] {
  if (value.length > MAX_RECIPIENT_TEXT) return [UNREADABLE_RECIPIENT];
  const parts: string[] = [];
  let current = "";
  for (const token of value.match(TOKEN) ?? []) {
    if (token === "," || token === ";") {
      parts.push(current);
      current = "";
    } else {
      current += token;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.trim() !== "").map(readPart);
}

/** The entries of a payload value: a string is split, a list is read element by element, anything else is unreadable. */
function entriesOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return splitRecipients(value);
  if (Array.isArray(value)) return value.flatMap((item: unknown) => (typeof item === "string" ? splitRecipients(item) : [UNREADABLE_RECIPIENT]));
  return [UNREADABLE_RECIPIENT];
}

/**
 * The normalised address when the value is exactly one readable address
 * (a display name is fine), else null: none, several, or something the
 * rules cannot read. A caller that must not guess, such as the test fence,
 * treats null as "not allowed".
 */
export function singleAddress(value: string): string | null {
  const entries = splitRecipients(value);
  const only = entries.length === 1 ? entries[0] : undefined;
  return only === undefined || only === UNREADABLE_RECIPIENT ? null : only;
}

/**
 * Who a send is written to, whatever its kind: the payload's `recipients`
 * list when it names anybody (a batch carries one, but a `batchId` is not
 * required), else `to`; then everyone in `cc` and `bcc`, so a copy cannot
 * reach a person the rules did not see. Strings are split on `,` and `;`,
 * lists are read element by element, and every entry is a normalised address
 * or {@link UNREADABLE_RECIPIENT}: what cannot be read is kept, never dropped.
 */
export function recipientsOf(spec: ActionSpec): readonly string[] {
  const listed = entriesOf(spec.payload?.recipients);
  const primary = listed.length > 0 ? listed : entriesOf(spec.payload?.to);
  return Object.freeze([...primary, ...entriesOf(spec.payload?.cc), ...entriesOf(spec.payload?.bcc)]);
}

/**
 * Every address a send could reach, each once in first-seen order:
 * {@link recipientsOf} plus the send's own `to` (a batch send carries both its
 * batch list and its own recipient). The test fence, the suppression lookup
 * and the outreach refusal all read this one list.
 */
export function addressesOf(spec: ActionSpec): readonly string[] {
  return Object.freeze([...new Set([...recipientsOf(spec), ...entriesOf(spec.payload?.to)])]);
}

/** An address is suppressed when it is listed itself or its domain is. */
function isSuppressed(address: string, suppressed: ReadonlySet<string>): boolean {
  if (suppressed.has(address)) return true;
  const at = address.lastIndexOf("@");
  return at >= 0 && suppressed.has(address.slice(at + 1));
}

/**
 * The first of the send's {@link addressesOf} that must not be written to:
 * suppressed itself or by its domain, or {@link UNREADABLE_RECIPIENT} (what
 * cannot be read is never sent to). Null when every address is clean. The
 * `suppressed` entries are normalised here again.
 */
export function suppressedAddressOf(spec: ActionSpec, suppressed: readonly string[]): string | null {
  const blocked = new Set(suppressed.map(normaliseEmail));
  return addressesOf(spec).find((entry) => entry === UNREADABLE_RECIPIENT || isSuppressed(entry, blocked)) ?? null;
}

/**
 * Why an outreach email must not be sent, or null when it may. A suppressed
 * recipient (address or domain) is refused first, then a company without a
 * sender identity. A recipient the rules cannot read as one address is
 * refused as `"suppressed"` too: the gate must not send to what it cannot
 * read. Every address of the send is checked ({@link addressesOf}: its list,
 * its own `to`, `cc` and `bcc`), so a suppressed address cannot ride along
 * behind a clean list or in a copy. Kinds other than first contact and reply
 * are none of this rule's business.
 */
export function outreachRefusal(spec: ActionSpec, ctx: OutreachContext): OutreachRefusal | null {
  if (!OUTREACH_KINDS.has(spec.kind)) return null;
  if (suppressedAddressOf(spec, ctx.suppressed) !== null) return "suppressed";
  return ctx.senderIdentity === null ? "no_sender_identity" : null;
}
