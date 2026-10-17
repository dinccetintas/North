// SLS-K2 / CMP-1: reading a Gmail thread back: which messages are human replies, which are bounces, and whether a reply asks to stop.

/** One message of a `threads.get?format=metadata` answer: its id, time and the requested headers only. */
export interface GmailThreadMessage {
  readonly id: string;
  readonly internalDate?: string;
  readonly payload?: { readonly headers?: readonly { readonly name: string; readonly value: string }[] };
}

/** The headers a thread read asks for: the sender, the two that mark automatic mail (M4 review L1), and the type that marks a delivery report (CMP-1). */
export const REPLY_METADATA_HEADERS = ["From", "Auto-Submitted", "Precedence", "Content-Type"] as const;

const AUTOMATED_PRECEDENCE = new Set(["bulk", "auto_reply", "junk"]);
/** Bounce senders on any domain; compared after `normaliseAddress`, so case does not matter. */
const BOUNCE_SENDERS = ["mailer-daemon@", "postmaster@"];
/** A delivery status notification's content type (RFC 3464): `multipart/report; report-type=delivery-status`. */
const DELIVERY_REPORT = /multipart\/report|delivery-status/;

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

/** A bounce or an automatic answer: `Auto-Submitted` other than `no`, `Precedence` bulk/auto_reply, or a mailer-daemon/postmaster sender. */
export function isAutomated(message: GmailThreadMessage): boolean {
  const auto = headerOf(message, "auto-submitted")?.trim().toLowerCase();
  if (auto !== undefined && auto !== "no") return true;
  const precedence = headerOf(message, "precedence")?.trim().toLowerCase();
  if (precedence !== undefined && AUTOMATED_PRECEDENCE.has(precedence)) return true;
  return BOUNCE_SENDERS.some((prefix) => senderOf(message).startsWith(prefix));
}

/**
 * CMP-1: a bounce notice: from `mailer-daemon@` or `postmaster@` (any domain,
 * any case), or `Auto-Submitted: auto-replied` on a delivery report
 * (`multipart/report`, `delivery-status`). An out-of-office is automated but no bounce.
 */
export function isBounce(message: GmailThreadMessage): boolean {
  if (BOUNCE_SENDERS.some((prefix) => senderOf(message).startsWith(prefix))) return true;
  const auto = headerOf(message, "auto-submitted")?.trim().toLowerCase() ?? "";
  const type = headerOf(message, "content-type")?.toLowerCase() ?? "";
  return auto.startsWith("auto-replied") && DELIVERY_REPORT.test(type);
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

/** CMP-1: whether a snippet (untrusted data of any type) asks to stop; anything but a string does not. */
export function asksToStop(snippet: unknown): boolean {
  return typeof snippet === "string" && OPT_OUT_PATTERN.test(snippet.slice(0, SNIPPET_MAX_CHARS));
}
