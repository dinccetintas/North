// SLS-K2 / CMP-1: reading a Gmail thread back: which messages are human replies, which are bounces, and whether a reply asks to stop.

/** One message of a `threads.get?format=metadata` answer: its id, time, the requested headers and, when Gmail sends it, the snippet (untrusted data). */
export interface GmailThreadMessage {
  readonly id: string;
  readonly internalDate?: string;
  readonly snippet?: unknown;
  readonly payload?: { readonly headers?: readonly { readonly name: string; readonly value: string }[] };
}

/** The headers a thread read asks for: the sender, the two that mark automatic mail (M4 review L1), and the type that marks a delivery report (CMP-1). */
export const REPLY_METADATA_HEADERS = ["From", "Auto-Submitted", "Precedence", "Content-Type"] as const;

const AUTOMATED_PRECEDENCE = new Set(["bulk", "auto_reply", "junk"]);
/**
 * The footer's own instruction (`Reply "no"`): a reply whose own words start
 * with "no" or "nope" (an opening quote allowed), except the friendly "no
 * problem", "no worries", "no rush" and "no doubt"; or that says "no thanks"
 * or "no thank you" anywhere in its own words.
 */
const STARTS_WITH_NO = /^\s*["'\u201c\u2018]?\s*no(?:pe)?\b(?!\s+(?:problems?|worries|worry|rush|doubt)\b)/i;
const NO_THANK_YOU = /\bno,?\s+thank(?:s|\s+you)\b/i;
/** Where quoted text starts in a flattened snippet: "On … wrote:", a `>` quote marker, an "Original Message" line, or Outlook's "From: … Sent:". */
const QUOTE_START = /\bOn\b[\s\S]{0,200}?\bwrote:|(?:^|\s)>|-{2,}\s*Original Message|\bFrom:\s[\s\S]{0,200}?\bSent:/i;
/** The HTML entities Gmail writes in snippets. */
const ENTITIES: Readonly<Record<string, string>> = Object.freeze({ "&quot;": '"', "&#34;": '"', "&#39;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" });

/** Bounce senders on any domain; compared after `normaliseAddress`, so case does not matter. */
const BOUNCE_SENDERS = ["mailer-daemon@", "postmaster@"];
/** A machine-made report (RFC 6522): delivery status notifications and read receipts alike. */
const REPORT = /multipart\/report/;
/** A delivery status notification (RFC 3464): `multipart/report; report-type=delivery-status`. */
const DELIVERY_STATUS = /report-type\s*=\s*"?delivery-status/;
/** A read receipt (RFC 8098): `report-type=disposition-notification`; never a bounce. */
const READ_RECEIPT = /report-type\s*=\s*"?disposition-notification/;

/**
 * CMP-1: a reply that asks to stop. The reply's snippet is matched against it
 * and nothing else: the text is data, never stored, forwarded or obeyed.
 */
export const OPT_OUT_PATTERN = /\b(unsubscribe|opt[- ]?out|stop (emailing|contacting)|remove me|not interested|no thanks)\b/i;

/** At most this many human replies per thread have their snippet read (one `messages.get?format=minimal` each). */
export const MAX_SNIPPETS_PER_THREAD = 20;
/** A snippet is matched on at most this many characters (Gmail's are ~200). */
const SNIPPET_MAX_CHARS = 2000;

/** `Name <addr>` or bare `addr` → lower-cased address. */
export function normaliseAddress(from: string): string {
  const angle = /<([^>]+)>/.exec(from);
  return (angle?.[1] ?? from).trim().toLowerCase();
}

const headerOf = (message: GmailThreadMessage, name: string): string | undefined => message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value;
const senderOf = (message: GmailThreadMessage): string => normaliseAddress(headerOf(message, "from") ?? "");

const contentTypeOf = (message: GmailThreadMessage): string => headerOf(message, "content-type")?.toLowerCase() ?? "";

/** A bounce or an automatic answer: `Auto-Submitted` other than `no`, `Precedence` bulk/auto_reply, a mailer-daemon/postmaster sender, or any `multipart/report` (a delivery report or a read receipt). */
export function isAutomated(message: GmailThreadMessage): boolean {
  const auto = headerOf(message, "auto-submitted")?.trim().toLowerCase();
  if (auto !== undefined && auto !== "no") return true;
  const precedence = headerOf(message, "precedence")?.trim().toLowerCase();
  if (precedence !== undefined && AUTOMATED_PRECEDENCE.has(precedence)) return true;
  return REPORT.test(contentTypeOf(message)) || BOUNCE_SENDERS.some((prefix) => senderOf(message).startsWith(prefix));
}

/**
 * CMP-1: a bounce notice: from `mailer-daemon@` or `postmaster@` (any domain,
 * any case), or a `multipart/report` with `report-type=delivery-status`
 * (whatever `Auto-Submitted` says). A read receipt
 * (`report-type=disposition-notification`) and an out-of-office are automated
 * but no bounce.
 */
export function isBounce(message: GmailThreadMessage): boolean {
  const type = contentTypeOf(message);
  if (READ_RECEIPT.test(type)) return false;
  if (BOUNCE_SENDERS.some((prefix) => senderOf(message).startsWith(prefix))) return true;
  return REPORT.test(type) && DELIVERY_STATUS.test(type);
}

/** The messages after the sent one (none when it is not in the thread). */
function after(messages: readonly GmailThreadMessage[], sentMessageId: string): readonly GmailThreadMessage[] {
  const index = messages.findIndex((m) => m.id === sentMessageId);
  return index === -1 ? [] : messages.slice(index + 1);
}

/** Messages after the sent one whose From is not the connected address and that are not bounces or auto-replies, in thread order. */
export function humanReplies(messages: readonly GmailThreadMessage[], sentMessageId: string, connected: string): readonly GmailThreadMessage[] {
  return Object.freeze(after(messages, sentMessageId).filter((m) => senderOf(m) !== connected && !isAutomated(m)));
}

/** The human replies after the sent one, the last one's time, and whether a bounce notice came back for it (CMP-1). */
export function countReplies(messages: readonly GmailThreadMessage[], sentMessageId: string, connected: string): { readonly replies: number; readonly lastReplyAt: string | null; readonly bounced: boolean } {
  const replies = humanReplies(messages, sentMessageId, connected);
  const times = replies.map((m) => Number(m.internalDate ?? NaN)).filter((t) => Number.isFinite(t));
  const last = times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
  return Object.freeze({ replies: replies.length, lastReplyAt: last, bounced: after(messages, sentMessageId).some(isBounce) });
}

/** The sender's own words of a snippet: entities decoded, cut where quoted text starts. */
function ownWords(snippet: string): string {
  const text = snippet.slice(0, SNIPPET_MAX_CHARS).replace(/&(?:quot|#34|#39|amp|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);
  const quote = QUOTE_START.exec(text);
  return quote ? text.slice(0, quote.index) : text;
}

/**
 * CMP-1: whether a snippet (untrusted data of any type) asks to stop: its own
 * words (quoted text is cut off) match `OPT_OUT_PATTERN`, start with "no" or
 * "nope" (the footer's own instruction), or say "no thanks"/"no thank you".
 * Anything but a string does not. The text is only matched, never kept.
 */
export function asksToStop(snippet: unknown): boolean {
  if (typeof snippet !== "string") return false;
  const words = ownWords(snippet);
  return OPT_OUT_PATTERN.test(words) || STARTS_WITH_NO.test(words) || NO_THANK_YOU.test(words);
}
