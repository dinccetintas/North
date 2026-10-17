// SLS-K2 / CMP-1: the user's mailbox in sandbox: sent records with their compliance parts, simulated replies, bounces and opt-outs.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ProviderError } from "../errors";
import { RepliesInputSchema, type MessageStatus, type OutreachMailProvider, type OutreachSendInput, type RepliesInput, type ReplyCount, type SendOutreachResult } from "../growth-types";
import { InReplyToSchema, ListUnsubscribeSchema, OutreachSendInputSchema, type ParsedOutreachSendInput } from "../outreach-input";
import type { SandboxSink } from "../types";
import { defaultSandboxRoot, safeJoin } from "./files";
import { recordSandboxEvent, sandboxRef } from "./record";

export { OutreachSendInputSchema };

/** What the sandbox keeps of a sent message: who, what, when, and the compliance parts it carried (CMP-1). Never the body. */
export const SandboxMessageSchema = z.object({
  messageId: z.string().min(1),
  companyId: z.string().min(1),
  to: z.email(),
  subject: z.string().min(1).max(998),
  kind: z.enum(["first_contact", "reply"]),
  sentAt: z.string(),
  /** The thread a reply was sent in (M4 review H2); absent on a first contact. */
  inReplyTo: InReplyToSchema.optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  /** CMP-1: the footer appended after the body, and the `List-Unsubscribe` targets, so a test can read them back. */
  footer: z.string().optional(),
  unsubscribe: ListUnsubscribeSchema.optional(),
});
export type SandboxMessage = z.infer<typeof SandboxMessageSchema>;

/**
 * CMP-1: the sandbox mailbox's address, the `mailto` target of `List-Unsubscribe`
 * in sandbox mode (there is no connected Gmail account to name). `.invalid`
 * never resolves.
 */
export const SANDBOX_OUTREACH_MAILBOX = "outreach@sandbox.north.invalid";

/** What came back on a sent message: a human reply, a bounce notice, or a reply asking to stop (CMP-1). */
export const SANDBOX_REPLY_KINDS = ["reply", "bounce", "opt_out"] as const;
export type SandboxReplyKind = (typeof SANDBOX_REPLY_KINDS)[number];

/** One line of `<messageId>.replies.jsonl`; a line written before CMP-1 has no kind and is a reply. */
const ReplyLineSchema = z.object({ at: z.iso.datetime({ offset: true }), kind: z.enum(SANDBOX_REPLY_KINDS).default("reply") });
export type SandboxReply = z.infer<typeof ReplyLineSchema>;

/** The compliance parts and copies of a send, as the record and the event keep them (absent keys stay absent). */
function extrasOf(input: ParsedOutreachSendInput): Partial<Pick<SandboxMessage, "inReplyTo" | "cc" | "bcc" | "footer" | "unsubscribe">> {
  return {
    ...(input.inReplyTo ? { inReplyTo: { ...input.inReplyTo } } : {}),
    ...(input.cc ? { cc: [...input.cc] } : {}),
    ...(input.bcc ? { bcc: [...input.bcc] } : {}),
    ...(input.footer ? { footer: input.footer } : {}),
    ...(input.unsubscribe ? { unsubscribe: { ...input.unsubscribe } } : {}),
  };
}

const ID = /^[A-Za-z0-9:._-]{1,120}$/;

/**
 * The user's mailbox in sandbox: `send` writes `<root>/mail/<messageId>.json`
 * (no body; the footer and `List-Unsubscribe` targets, CMP-1), `simulateReply`
 * (worker-only route) appends a reply, a bounce or an opt-out to
 * `<messageId>.replies.jsonl`, `replies` counts those lines, `status` checks
 * the file exists. A new instance over the same root sees everything.
 */
export class SandboxOutreach implements OutreachMailProvider {
  private readonly dir: string;

  constructor(
    private readonly sink?: SandboxSink,
    root: string = defaultSandboxRoot(),
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.dir = join(root, "mail");
  }

  private messagePath(messageId: string): string | null {
    return ID.test(messageId) ? safeJoin(this.dir, `${messageId}.json`) : null;
  }

  private repliesPath(messageId: string): string | null {
    return ID.test(messageId) ? safeJoin(this.dir, `${messageId}.replies.jsonl`) : null;
  }

  private async readMessage(messageId: string): Promise<SandboxMessage | null> {
    const path = this.messagePath(messageId);
    if (!path) return null;
    try {
      const parsed = SandboxMessageSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
      return parsed.success ? Object.freeze(parsed.data) : null;
    } catch {
      return null;
    }
  }

  private async readReplies(messageId: string): Promise<readonly SandboxReply[]> {
    const path = this.repliesPath(messageId);
    if (!path) return Object.freeze([]);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return Object.freeze([]);
    }
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    return Object.freeze(
      lines.flatMap((l) => {
        try {
          const parsed = ReplyLineSchema.safeParse(JSON.parse(l));
          return parsed.success ? [Object.freeze(parsed.data)] : [];
        } catch {
          return [];
        }
      }),
    );
  }

  /** Writes the record (the compliance parts included, CMP-1); the event says whether they were there, without the link itself. */
  async send(raw: OutreachSendInput): Promise<SendOutreachResult> {
    const input = OutreachSendInputSchema.parse(raw);
    const messageId = sandboxRef("msg");
    const extras = extrasOf(input);
    const message: SandboxMessage = Object.freeze({ messageId, companyId: input.companyId, to: input.to, subject: input.subject, kind: input.kind, sentAt: this.clock().toISOString(), ...extras });
    const path = this.messagePath(messageId);
    if (!path) throw new ProviderError("sandbox-outreach", "could not build a message path");
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, JSON.stringify(message, null, 2), "utf8");
    const copies = { ...(extras.cc ? { cc: extras.cc } : {}), ...(extras.bcc ? { bcc: extras.bcc } : {}) };
    await recordSandboxEvent(this.sink, {
      provider: "outreach",
      op: "send",
      companyId: input.companyId,
      ref: messageId,
      payload: { to: input.to, subject: input.subject, kind: input.kind, textChars: input.text.length, footer: extras.footer !== undefined, listUnsubscribe: extras.unsubscribe !== undefined, ...copies, ...(extras.inReplyTo ? { inReplyTo: extras.inReplyTo } : {}) },
    });
    return Object.freeze({ messageId, sandbox: true });
  }

  /**
   * Per-message reply counts; messages that are missing or belong to another
   * company count zero. A bounce line is never a reply, only `bounced`; an
   * opt-out line is a human reply that also sets `optedOut` (as in Gmail).
   */
  async replies(raw: RepliesInput): Promise<readonly ReplyCount[]> {
    const input = RepliesInputSchema.parse(raw);
    const counts: ReplyCount[] = [];
    for (const messageId of input.messageIds) {
      const message = await this.readMessage(messageId);
      const lines = message && message.companyId === input.companyId ? await this.readReplies(messageId) : [];
      const human = lines.filter((r) => r.kind !== "bounce");
      const last = human.map((r) => r.at).sort().at(-1) ?? null;
      counts.push(Object.freeze({ messageId, replies: human.length, lastReplyAt: last, bounced: lines.some((r) => r.kind === "bounce"), optedOut: lines.some((r) => r.kind === "opt_out") }));
    }
    return Object.freeze(counts);
  }

  /** CMP-1: the sandbox mailbox (there is no connected account to name). */
  async mailbox(): Promise<string> {
    return SANDBOX_OUTREACH_MAILBOX;
  }

  async status(messageId: string): Promise<MessageStatus> {
    return (await this.readMessage(messageId)) ? "sent" : "unknown";
  }

  /** Simulation route: a reply, a bounce notice or an opt-out reply (CMP-1) arrived on this message at `at` (default now). */
  async simulateReply(messageId: string, at?: string, kind: SandboxReplyKind = "reply"): Promise<SandboxReply> {
    const message = await this.readMessage(messageId);
    const path = this.repliesPath(messageId);
    if (!message || !path) throw new ProviderError("sandbox-outreach", `unknown message ${messageId}`);
    const line = ReplyLineSchema.parse({ at: at ?? this.clock().toISOString(), kind });
    await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
    await recordSandboxEvent(this.sink, { provider: "outreach", op: "simulateReply", companyId: message.companyId, ref: messageId, payload: { at: line.at, kind: line.kind } });
    return Object.freeze(line);
  }
}
