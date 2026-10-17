// SLS-K2 / CMP-1: the user's own Gmail: outreach leaves through it with its footer and List-Unsubscribe, replies, bounces and opt-outs come back from it.
import { NotConfiguredError, ProviderError, redactSecret as redact } from "../errors";
import { RepliesInputSchema, type InReplyTo, type MessageStatus, type OutreachMailProvider, type OutreachSendInput, type RepliesInput, type ReplyCount, type SendOutreachResult } from "../growth-types";
import { OutreachSendInputSchema, type ParsedOutreachSendInput } from "../outreach-input";
import type { ProviderAuth } from "../types";
import type { FetchLike } from "./github";
import { buildRawMessage } from "./gmail-message";
import { asksToStop, countReplies, humanReplies, MAX_SNIPPETS_PER_THREAD, normaliseAddress, REPLY_METADATA_HEADERS, type GmailThreadMessage } from "./gmail-replies";

export { buildRawMessage, FOOTER_MARKER, type RawMessageInput } from "./gmail-message";
export { asksToStop, countReplies, humanReplies, isAutomated, isBounce, MAX_SNIPPETS_PER_THREAD, normaliseAddress, OPT_OUT_PATTERN, REPLY_METADATA_HEADERS, type GmailThreadMessage } from "./gmail-replies";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const NOT_CONNECTED = "Gmail is not connected for this user (connect it in Settings → Connections)";
const REF_PREFIX = "gmail:";

const base64url = (buffer: Buffer): string => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** `gmail:<messageId>:<threadId>` → its parts; null for any other reference. */
export function parseGmailRef(ref: string): { readonly messageId: string; readonly threadId: string } | null {
  if (!ref.startsWith(REF_PREFIX)) return null;
  const [messageId, threadId, ...rest] = ref.slice(REF_PREFIX.length).split(":");
  return messageId && threadId && rest.length === 0 ? Object.freeze({ messageId, threadId }) : null;
}

/**
 * CMP-1, the belt on the wire: a live outreach email leaves only with its
 * compliance footer and `List-Unsubscribe`, and the one-click link is https
 * (RFC 8058). The reason, or null when the send may go.
 */
function complianceRefusal(input: ParsedOutreachSendInput): string | null {
  if (!input.footer || !input.unsubscribe) return "an outreach email needs its compliance footer and List-Unsubscribe (CMP-1); nothing was sent";
  return input.unsubscribe.url.startsWith("https://") ? null : "List-Unsubscribe needs an https link (RFC 8058); nothing was sent";
}

const noReplies = (messageId: string): ReplyCount => Object.freeze({ messageId, replies: 0, lastReplyAt: null, bounced: false, optedOut: false });

/**
 * The user's Gmail through their OAuth token (SLS-K2, ADR 0010): sends an
 * RFC 2822 message, reads the thread back to count replies, checks a message
 * exists. The token is a bearer header only; errors never echo it.
 */
export class GmailOutreach implements OutreachMailProvider {
  private connectedAddress: string | null;

  constructor(
    private readonly auth: ProviderAuth | null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.connectedAddress = auth?.account ? normaliseAddress(auth.account) : null;
  }

  private async api<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, okStatuses: readonly number[] = [200]): Promise<{ status: number; data: T | null }> {
    if (!this.auth) throw new NotConfiguredError(NOT_CONNECTED);
    let response: Response;
    try {
      response = await this.fetchImpl(`${GMAIL_API}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.auth.token}`, "content-type": "application/json", accept: "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ProviderError("gmail", redact(error instanceof Error ? error.message : "request failed", this.auth.token));
    }
    if (!okStatuses.includes(response.status)) {
      const text = await response.text().catch(() => "");
      let message = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message.slice(0, 200);
      } catch {
        // not JSON: the truncated body is the message
      }
      throw new ProviderError("gmail", redact(`${method} ${path} → ${response.status} ${message}`, this.auth.token));
    }
    const data = response.status === 200 ? ((await response.json()) as T) : null;
    return { status: response.status, data };
  }

  private async connected(): Promise<string> {
    if (this.connectedAddress) return this.connectedAddress;
    const { data } = await this.api<{ emailAddress?: string }>("GET", "/profile");
    if (!data?.emailAddress) throw new ProviderError("gmail", "profile has no email address");
    this.connectedAddress = normaliseAddress(data.emailAddress);
    return this.connectedAddress;
  }

  /** The RFC 2822 `Message-ID` of a sent message (what a reply's `In-Reply-To` must name); the API id as a best effort when the header is unavailable. */
  private async rfcMessageId(thread: InReplyTo): Promise<string> {
    const { data } = await this.api<{ payload?: { headers?: readonly { name: string; value: string }[] } }>("GET", `/messages/${encodeURIComponent(thread.messageId)}?format=metadata&metadataHeaders=Message-ID`, undefined, [200, 404]);
    const header = data?.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value.trim();
    return header && header.length > 0 ? header : `<${thread.messageId}>`;
  }

  /**
   * A reply goes into the thread it answers (`threadId` in the request,
   * `In-Reply-To`/`References` in the message); a first contact opens a new
   * one. Not connected is reported first; CMP-1: refused before any request
   * without the footer and an https `List-Unsubscribe`; `Cc`/`Bcc` come from
   * the parsed arrays only.
   */
  async send(raw: OutreachSendInput): Promise<SendOutreachResult> {
    const input = OutreachSendInputSchema.parse(raw);
    if (!this.auth) throw new NotConfiguredError(NOT_CONNECTED);
    const refusal = complianceRefusal(input);
    if (refusal) throw new ProviderError("gmail", refusal);
    const inReplyTo = input.inReplyTo ? await this.rfcMessageId(input.inReplyTo) : undefined;
    const { to, subject, text, cc, bcc, footer, unsubscribe } = input;
    const rawMessage = base64url(Buffer.from(buildRawMessage({ to, subject, text, ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}), ...(footer ? { footer } : {}), ...(unsubscribe ? { unsubscribe } : {}), ...(inReplyTo ? { inReplyTo } : {}) }), "utf8"));
    const { data } = await this.api<{ id?: string; threadId?: string }>("POST", "/messages/send", { raw: rawMessage, ...(input.inReplyTo ? { threadId: input.inReplyTo.threadId } : {}) });
    if (!data?.id || !data.threadId) throw new ProviderError("gmail", "send returned no message id");
    return Object.freeze({ messageId: `${REF_PREFIX}${data.id}:${data.threadId}`, sandbox: false });
  }

  /**
   * One `threads.get` per sent message (`format=metadata`, the headers in
   * `REPLY_METADATA_HEADERS`); a non-Gmail ref or a missing thread counts
   * zero. CMP-1: `bounced` from the thread's headers; unless bounced, the
   * snippet of each human reply (the first `MAX_SNIPPETS_PER_THREAD`, one
   * `messages.get?format=minimal` each) is matched against `OPT_OUT_PATTERN`
   * for `optedOut`, and dropped: it is never stored or returned.
   */
  async replies(raw: RepliesInput): Promise<readonly ReplyCount[]> {
    const input = RepliesInputSchema.parse(raw);
    const connected = await this.connected();
    const counts: ReplyCount[] = [];
    for (const messageId of input.messageIds) counts.push(await this.countFor(messageId, connected));
    return Object.freeze(counts);
  }

  private async countFor(messageId: string, connected: string): Promise<ReplyCount> {
    const ref = parseGmailRef(messageId);
    if (!ref) return noReplies(messageId);
    const { data } = await this.api<{ messages?: readonly GmailThreadMessage[] }>("GET", `/threads/${encodeURIComponent(ref.threadId)}?format=metadata&${REPLY_METADATA_HEADERS.map((h) => `metadataHeaders=${h}`).join("&")}`, undefined, [200, 404]);
    const messages = data?.messages ?? [];
    const counted = countReplies(messages, ref.messageId, connected);
    const optedOut = counted.bounced ? false : await this.anyAsksToStop(humanReplies(messages, ref.messageId, connected));
    return Object.freeze({ messageId, ...counted, optedOut });
  }

  /** CMP-1: reads the snippets of the first replies one by one and stops at the first that asks to stop; a 404 is no snippet. */
  private async anyAsksToStop(replies: readonly GmailThreadMessage[]): Promise<boolean> {
    for (const reply of replies.slice(0, MAX_SNIPPETS_PER_THREAD)) {
      const { data } = await this.api<{ snippet?: unknown }>("GET", `/messages/${encodeURIComponent(reply.id)}?format=minimal`, undefined, [200, 404]);
      if (asksToStop(data?.snippet)) return true;
    }
    return false;
  }

  async status(messageId: string): Promise<MessageStatus> {
    const ref = parseGmailRef(messageId);
    if (!ref) return "unknown";
    const { status } = await this.api("GET", `/messages/${encodeURIComponent(ref.messageId)}?format=minimal`, undefined, [200, 404]);
    return status === 200 ? "sent" : "unknown";
  }
}
