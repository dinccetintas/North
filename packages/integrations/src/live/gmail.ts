import { NotConfiguredError, ProviderError, redactSecret as redact } from "../errors";
import { RepliesInputSchema, type MessageStatus, type OutreachMailProvider, type OutreachSendInput, type RepliesInput, type ReplyCount, type SendOutreachResult } from "../growth-types";
import { OutreachSendInputSchema } from "../sandbox/outreach";
import type { ProviderAuth } from "../types";
import type { FetchLike } from "./github";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const NOT_CONNECTED = "Gmail is not connected for this user (connect it in Settings → Connections)";
const REF_PREFIX = "gmail:";

const base64url = (buffer: Buffer): string => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** One header line: CR/LF stripped so a subject can never smuggle a second header; non-ASCII goes RFC 2047 base64. */
function headerValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** The RFC 2822 message Gmail sends: To, Subject, MIME headers, a base64 text/plain body. `From` is the connected mailbox (Gmail fills it). */
export function buildRawMessage(input: { readonly to: string; readonly subject: string; readonly text: string }): string {
  const headers = [`To: ${headerValue(input.to)}`, `Subject: ${headerValue(input.subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"];
  const body = Buffer.from(input.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** `Name <addr>` or bare `addr` → lower-cased address. */
export function normaliseAddress(from: string): string {
  const angle = /<([^>]+)>/.exec(from);
  return (angle?.[1] ?? from).trim().toLowerCase();
}

/** `gmail:<messageId>:<threadId>` → its parts; null for any other reference. */
export function parseGmailRef(ref: string): { readonly messageId: string; readonly threadId: string } | null {
  if (!ref.startsWith(REF_PREFIX)) return null;
  const [messageId, threadId, ...rest] = ref.slice(REF_PREFIX.length).split(":");
  return messageId && threadId && rest.length === 0 ? Object.freeze({ messageId, threadId }) : null;
}

interface GmailThreadMessage {
  readonly id: string;
  readonly internalDate?: string;
  readonly payload?: { readonly headers?: readonly { readonly name: string; readonly value: string }[] };
}

const fromOf = (message: GmailThreadMessage): string | undefined => message.payload?.headers?.find((h) => h.name.toLowerCase() === "from")?.value;

/** Messages after the sent one whose From is not the connected address; the last one's time. */
export function countReplies(messages: readonly GmailThreadMessage[], sentMessageId: string, connected: string): { readonly replies: number; readonly lastReplyAt: string | null } {
  const index = messages.findIndex((m) => m.id === sentMessageId);
  const after = index === -1 ? [] : messages.slice(index + 1);
  const replies = after.filter((m) => normaliseAddress(fromOf(m) ?? "") !== connected);
  const times = replies.map((m) => Number(m.internalDate ?? NaN)).filter((t) => Number.isFinite(t));
  const last = times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
  return Object.freeze({ replies: replies.length, lastReplyAt: last });
}

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

  async send(raw: OutreachSendInput): Promise<SendOutreachResult> {
    const input = OutreachSendInputSchema.parse(raw);
    const rawMessage = base64url(Buffer.from(buildRawMessage(input), "utf8"));
    const { data } = await this.api<{ id?: string; threadId?: string }>("POST", "/messages/send", { raw: rawMessage });
    if (!data?.id || !data.threadId) throw new ProviderError("gmail", "send returned no message id");
    return Object.freeze({ messageId: `${REF_PREFIX}${data.id}:${data.threadId}`, sandbox: false });
  }

  /** One `threads.get` per sent message; a non-Gmail ref or a missing thread counts zero. */
  async replies(raw: RepliesInput): Promise<readonly ReplyCount[]> {
    const input = RepliesInputSchema.parse(raw);
    const connected = await this.connected();
    const counts: ReplyCount[] = [];
    for (const messageId of input.messageIds) {
      const ref = parseGmailRef(messageId);
      if (!ref) {
        counts.push(Object.freeze({ messageId, replies: 0, lastReplyAt: null }));
        continue;
      }
      const { data } = await this.api<{ messages?: readonly GmailThreadMessage[] }>("GET", `/threads/${encodeURIComponent(ref.threadId)}?format=metadata&metadataHeaders=From`, undefined, [200, 404]);
      const counted = countReplies(data?.messages ?? [], ref.messageId, connected);
      counts.push(Object.freeze({ messageId, ...counted }));
    }
    return Object.freeze(counts);
  }

  async status(messageId: string): Promise<MessageStatus> {
    const ref = parseGmailRef(messageId);
    if (!ref) return "unknown";
    const { status } = await this.api("GET", `/messages/${encodeURIComponent(ref.messageId)}?format=minimal`, undefined, [200, 404]);
    return status === 200 ? "sent" : "unknown";
  }
}
