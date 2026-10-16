// TST-1: the cost of a Messages API reply, read from its body. A JSON body
// carries `usage` and `model`; an SSE stream carries them in `message_start`
// and the final `message_delta`. The body is untrusted: every shape is parsed.
import { usageFromApi, type ModelUsage } from "@north/core";
import { z } from "zod";
import { contentTypeOf, type Headers } from "./headers";

const UsageFields = z.record(z.string(), z.unknown());
const MessageStartSchema = z.object({ type: z.literal("message_start"), message: z.object({ model: z.string().min(1), usage: UsageFields }) });
const MessageDeltaSchema = z.object({ type: z.literal("message_delta"), usage: UsageFields });

/** The JSON payload of each SSE event in the text; events that are not JSON are skipped. */
function* eventPayloads(text: string): Generator<unknown> {
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      yield JSON.parse(data) as unknown;
    } catch {
      // Not an event this gateway prices.
    }
  }
}

/** Drops null and absent fields: a later usage object only overrides with a real count. */
const definedOnly = (fields: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined));

/**
 * Usage of an SSE stream: `message_start`'s usage and model, with the fields
 * of every `message_delta` laid over them (the counts are cumulative, and
 * older streams repeat only `output_tokens`). A stream cut short is priced from
 * what arrived. Null without a `message_start`.
 */
export function usageFromSse(text: string): ModelUsage | null {
  let start: { model: string; usage: Record<string, unknown> } | null = null;
  let delta: Record<string, unknown> = {};
  for (const payload of eventPayloads(text)) {
    const started = MessageStartSchema.safeParse(payload);
    if (started.success) {
      start = started.data.message;
      continue;
    }
    const updated = MessageDeltaSchema.safeParse(payload);
    if (updated.success) delta = { ...delta, ...definedOnly(updated.data.usage) };
  }
  return start === null ? null : usageFromApi({ model: start.model, usage: { ...definedOnly(start.usage), ...delta } });
}

/** Usage of a whole reply body, by its content type; null when it has none to read. */
export function usageFromResponse(body: Buffer, headers: Headers): ModelUsage | null {
  const text = body.toString("utf8");
  if (contentTypeOf(headers).startsWith("text/event-stream")) return usageFromSse(text);
  try {
    return usageFromApi(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
