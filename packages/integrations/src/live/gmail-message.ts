// SLS-K2 / CMP-1: the RFC 2822 message the Gmail adapter sends: one-line headers, copies, List-Unsubscribe and the footer after the body.
import { FOOTER_MARKER } from "@north/core";
import type { ListUnsubscribe } from "../growth-types";

export { FOOTER_MARKER };

/** What `buildRawMessage` writes; the adapter has parsed every field with `OutreachSendInputSchema` first. */
export interface RawMessageInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** The RFC 2822 `Message-ID` a reply answers. */
  readonly inReplyTo?: string;
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly footer?: string;
  readonly unsubscribe?: ListUnsubscribe;
}

/** One header line: CR/LF stripped so a value can never smuggle a second header; non-ASCII goes RFC 2047 base64. */
function headerValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** `Cc`/`Bcc` lines from the arrays only (none for an empty or absent list). */
function copyHeaders(input: RawMessageInput): string[] {
  const line = (name: string, list: readonly string[] | undefined): string[] => (list && list.length > 0 ? [`${name}: ${list.map(headerValue).join(", ")}`] : []);
  return [...line("Cc", input.cc), ...line("Bcc", input.bcc)];
}

/** RFC 2369 `List-Unsubscribe` with both targets, and RFC 8058's one-click marker. */
function unsubscribeHeaders(unsubscribe: ListUnsubscribe | undefined): string[] {
  if (!unsubscribe) return [];
  return [`List-Unsubscribe: <mailto:${headerValue(unsubscribe.mailto)}>, <${headerValue(unsubscribe.url)}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"];
}

/**
 * The RFC 2822 message Gmail sends: To (and Cc/Bcc from the arrays), Subject,
 * MIME headers, a base64 text/plain body; for a reply, `In-Reply-To` and
 * `References` naming the message it answers (M4 review H2); CMP-1: the
 * `List-Unsubscribe` headers when `unsubscribe` is given, and the footer after
 * {@link FOOTER_MARKER} when `footer` is (always appended, never detected).
 * `From` is the connected mailbox (Gmail fills it).
 */
export function buildRawMessage(input: RawMessageInput): string {
  const thread = input.inReplyTo ? [`In-Reply-To: ${headerValue(input.inReplyTo)}`, `References: ${headerValue(input.inReplyTo)}`] : [];
  const headers = [`To: ${headerValue(input.to)}`, ...copyHeaders(input), `Subject: ${headerValue(input.subject)}`, ...thread, ...unsubscribeHeaders(input.unsubscribe), "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"];
  const text = input.footer ? `${input.text}${FOOTER_MARKER}${input.footer}` : input.text;
  const body = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}
