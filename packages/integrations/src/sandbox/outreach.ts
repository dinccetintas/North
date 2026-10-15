import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ProviderError } from "../errors";
import { RepliesInputSchema, type MessageStatus, type OutreachMailProvider, type OutreachSendInput, type RepliesInput, type ReplyCount, type SendOutreachResult } from "../growth-types";
import type { SandboxSink } from "../types";
import { defaultSandboxRoot, safeJoin } from "./files";
import { recordSandboxEvent, sandboxRef } from "./record";

/** What the sandbox keeps of a sent message: who, what and when. Never the body. */
const InReplyToSchema = z.object({ messageId: z.string().min(1).max(200), threadId: z.string().min(1).max(200) });

export const SandboxMessageSchema = z.object({
  messageId: z.string().min(1),
  companyId: z.string().min(1),
  to: z.email(),
  subject: z.string().min(1).max(998),
  kind: z.enum(["first_contact", "reply"]),
  sentAt: z.string(),
  /** The thread a reply was sent in (M4 review H2); absent on a first contact. */
  inReplyTo: InReplyToSchema.optional(),
});
export type SandboxMessage = z.infer<typeof SandboxMessageSchema>;

export const OutreachSendInputSchema = z.object({
  companyId: z.string().min(1),
  to: z.email(),
  subject: z.string().trim().min(1).max(998),
  text: z.string().min(1).max(100_000),
  kind: z.enum(["first_contact", "reply"]),
  inReplyTo: InReplyToSchema.optional(),
});

const ReplyLineSchema = z.object({ at: z.iso.datetime({ offset: true }) });
export type SandboxReply = z.infer<typeof ReplyLineSchema>;

const ID = /^[A-Za-z0-9:._-]{1,120}$/;

/**
 * The user's mailbox in sandbox: `send` writes `<root>/mail/<messageId>.json`
 * (no body), `simulateReply` (worker-only route) appends to
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

  async send(raw: OutreachSendInput): Promise<SendOutreachResult> {
    const input = OutreachSendInputSchema.parse(raw);
    const messageId = sandboxRef("msg");
    const thread = input.inReplyTo ? { inReplyTo: { ...input.inReplyTo } } : {};
    const message: SandboxMessage = Object.freeze({ messageId, companyId: input.companyId, to: input.to, subject: input.subject, kind: input.kind, sentAt: this.clock().toISOString(), ...thread });
    const path = this.messagePath(messageId);
    if (!path) throw new ProviderError("sandbox-outreach", "could not build a message path");
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, JSON.stringify(message, null, 2), "utf8");
    await recordSandboxEvent(this.sink, {
      provider: "outreach",
      op: "send",
      companyId: input.companyId,
      ref: messageId,
      payload: { to: input.to, subject: input.subject, kind: input.kind, textChars: input.text.length, ...thread },
    });
    return Object.freeze({ messageId, sandbox: true });
  }

  /** Per-message reply counts; messages that are missing or belong to another company count zero. */
  async replies(raw: RepliesInput): Promise<readonly ReplyCount[]> {
    const input = RepliesInputSchema.parse(raw);
    const counts: ReplyCount[] = [];
    for (const messageId of input.messageIds) {
      const message = await this.readMessage(messageId);
      const lines = message && message.companyId === input.companyId ? await this.readReplies(messageId) : [];
      const last = lines.map((r) => r.at).sort().at(-1) ?? null;
      counts.push(Object.freeze({ messageId, replies: lines.length, lastReplyAt: last }));
    }
    return Object.freeze(counts);
  }

  async status(messageId: string): Promise<MessageStatus> {
    return (await this.readMessage(messageId)) ? "sent" : "unknown";
  }

  /** Simulation route: a reply arrived on this message at `at` (default now). */
  async simulateReply(messageId: string, at?: string): Promise<SandboxReply> {
    const message = await this.readMessage(messageId);
    const path = this.repliesPath(messageId);
    if (!message || !path) throw new ProviderError("sandbox-outreach", `unknown message ${messageId}`);
    const line = ReplyLineSchema.parse({ at: at ?? this.clock().toISOString() });
    await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
    await recordSandboxEvent(this.sink, { provider: "outreach", op: "simulateReply", companyId: message.companyId, ref: messageId, payload: { at: line.at } });
    return Object.freeze(line);
  }
}
