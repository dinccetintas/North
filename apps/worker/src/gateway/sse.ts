// TST-1: the usage of a Server-Sent Events reply, read as the bytes go by. Only
// the `message_start` usage and model and the latest `message_delta` usage are
// kept, plus the partial line being read, so pricing a stream needs no copy of
// it and never depends on the capture limit.
import { StringDecoder } from "node:string_decoder";
import { usageFromApi, type ModelUsage } from "@north/core";
import { z } from "zod";

/** The most characters of one line, or of one event's data lines, that are read: far more than any usage event. */
const MAX_EVENT_CHARS = 1024 * 1024;

const UsageFields = z.record(z.string(), z.unknown());
const MessageStartSchema = z.object({ type: z.literal("message_start"), message: z.object({ model: z.string().min(1), usage: UsageFields }) });
const MessageDeltaSchema = z.object({ type: z.literal("message_delta"), usage: UsageFields });
const ErrorEventSchema = z.object({ type: z.literal("error") });

/** Drops null and absent fields: a later usage object only overrides with a real count. */
const definedOnly = (fields: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined));

/** Reads usage out of an SSE stream pushed in chunks of any size. */
export interface SseUsage {
  push(chunk: Buffer): void;
  /** The usage seen so far; null without a `message_start`. Ends the stream: later chunks are ignored. */
  result(): ModelUsage | null;
  /** True when the stream carried an `error` event and no `message_start`: the upstream failed before billing anything. Ends the stream like `result`. */
  errorOnly(): boolean;
}

/** The reader behind `createSseUsage`. */
class SseUsageReader implements SseUsage {
  private readonly decoder = new StringDecoder("utf8");
  private pending = ""; // the partial last line
  private skipLine = false; // inside a line too long to be an event: drop it up to its newline
  private dataLines: string[] = [];
  private eventChars = 0;
  private oversize = false; // inside an event too long to be a usage event: drop it up to its blank line
  private started: { model: string; usage: Record<string, unknown> } | null = null;
  private delta: Record<string, unknown> = {};
  private sawError = false;
  private final: ModelUsage | null | undefined;

  push(chunk: Buffer): void {
    if (this.final !== undefined) return;
    const parts = (this.pending + this.decoder.write(chunk)).split("\n");
    this.pending = parts.pop() ?? "";
    for (const part of parts) {
      if (this.skipLine) this.skipLine = false;
      else this.line(part);
    }
    if (this.pending.length > MAX_EVENT_CHARS) {
      this.pending = "";
      this.skipLine = true;
    }
  }

  result(): ModelUsage | null {
    if (this.final !== undefined) return this.final;
    const rest = this.pending + this.decoder.end();
    if (rest !== "" && !this.skipLine) this.line(rest);
    this.flush();
    const { started } = this;
    this.final = started === null ? null : usageFromApi({ model: started.model, usage: { ...definedOnly(started.usage), ...this.delta } });
    return this.final;
  }

  errorOnly(): boolean {
    this.result();
    return this.sawError && this.started === null;
  }

  private line(raw: string): void {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (text === "") return this.flush();
    if (this.oversize || !text.startsWith("data:")) return;
    this.eventChars += text.length;
    if (this.eventChars > MAX_EVENT_CHARS) {
      this.oversize = true;
      this.dataLines = [];
      return;
    }
    this.dataLines.push(text.slice(5).replace(/^ /, ""));
  }

  private flush(): void {
    if (!this.oversize && this.dataLines.length > 0) this.apply(this.dataLines.join("\n"));
    this.dataLines = [];
    this.eventChars = 0;
    this.oversize = false;
  }

  private apply(data: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      return; // not an event this reader prices
    }
    const started = MessageStartSchema.safeParse(payload);
    if (started.success) {
      this.started = started.data.message;
      return;
    }
    const updated = MessageDeltaSchema.safeParse(payload);
    if (updated.success) {
      this.delta = { ...this.delta, ...definedOnly(updated.data.usage) };
      return;
    }
    if (ErrorEventSchema.safeParse(payload).success) this.sawError = true;
  }
}

/** A new reader. A stream cut short is priced from what arrived. */
export const createSseUsage = (): SseUsage => new SseUsageReader();

/** A whole SSE body held in memory (a replayed cassette), read to its end. */
export function readSse(text: string): SseUsage {
  const reader = createSseUsage();
  reader.push(Buffer.from(text, "utf8"));
  reader.result();
  return reader;
}

/** Usage of a whole SSE body held in memory (a replayed cassette). */
export const usageFromSse = (text: string): ModelUsage | null => readSse(text).result();
