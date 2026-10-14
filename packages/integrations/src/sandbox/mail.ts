import { SendMailInputSchema, type MailProvider, type SandboxSink, type SendMailInput, type SendMailResult } from "../types";
import { recordSandboxEvent, sandboxRef } from "./record";

/** Mail provider that records instead of sending. The body is never stored; only who, what and why. */
export class SandboxMail implements MailProvider {
  constructor(private readonly sink?: SandboxSink) {}

  async send(raw: SendMailInput): Promise<SendMailResult> {
    const input = SendMailInputSchema.parse(raw);
    const messageId = sandboxRef("msg");
    await recordSandboxEvent(this.sink, {
      provider: "mail",
      op: "send",
      companyId: input.companyId,
      ref: messageId,
      payload: { to: input.to, subject: input.subject, kind: input.kind, textChars: input.text.length },
    });
    return Object.freeze({ messageId, sandbox: true });
  }
}
