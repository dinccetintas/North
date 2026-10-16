// TST-1: the cost of a Messages API reply, read from its body. A JSON body
// carries `usage` and `model`; an SSE stream carries them in `message_start`
// and the final `message_delta` (see `sse.ts`). The body is untrusted: every
// shape is parsed, and a reply with no readable usage yields null.
import { usageFromApi, type ModelUsage } from "@north/core";
import { isEncoded, isEventStream, type Headers } from "./headers";
import { usageFromSse, type SseUsage } from "./sse";

/** Usage of a non-streaming JSON body; null when it is not JSON or has no usable usage. */
export function usageFromJson(body: Buffer): ModelUsage | null {
  try {
    return usageFromApi(JSON.parse(body.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

/** Usage of a whole reply body held in memory (a replayed cassette): an encoded body has none to read. */
export function usageFromResponse(body: Buffer, headers: Headers): ModelUsage | null {
  if (isEncoded(headers)) return null;
  return isEventStream(headers) ? usageFromSse(body.toString("utf8")) : usageFromJson(body);
}

/**
 * Usage of a live reply once it has ended. A stream is read by `sse` as it
 * went by (whatever the capture limit); any other body from the bounded copy,
 * which is null when the reply outgrew the limit. An encoded body has none.
 */
export function replyUsage(headers: Headers, sse: SseUsage | null, captured: Buffer | null): ModelUsage | null {
  if (isEncoded(headers)) return null;
  if (sse !== null) return sse.result();
  return captured === null ? null : usageFromJson(captured);
}
