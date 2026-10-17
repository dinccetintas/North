// TST-1: the cost of a Messages API reply, read from its body. A JSON body
// carries `usage` and `model`; an SSE stream carries them in `message_start`
// and the final `message_delta` (see `sse.ts`). The body is untrusted: every
// shape is parsed, and a reply with no readable usage yields null. A 2xx
// stream that carried only an `error` event yields `UPSTREAM_ERROR`: the
// upstream failed and billed nothing.
import { usageFromApi, type ModelUsage } from "@north/core";
import { isEncoded, isEventStream, type Headers } from "./headers";
import { readSse, type SseUsage } from "./sse";

/** A 2xx stream with an `error` event and no `message_start`: an upstream error, which costs nothing. */
export const UPSTREAM_ERROR = "upstream_error";

/** What a finished reply tells the budget: its usage, null when none can be read, or `UPSTREAM_ERROR`. */
export type ReplyUsage = ModelUsage | null | typeof UPSTREAM_ERROR;

/** The usage of a stream that has ended, or `UPSTREAM_ERROR` for one that carried only an error. */
const streamUsage = (sse: SseUsage): ReplyUsage => (sse.errorOnly() ? UPSTREAM_ERROR : sse.result());

/** Usage of a non-streaming JSON body; null when it is not JSON or has no usable usage. */
export function usageFromJson(body: Buffer): ModelUsage | null {
  try {
    return usageFromApi(JSON.parse(body.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

/** Usage of a whole reply body held in memory (a replayed cassette): an encoded body has none to read. */
export function usageFromResponse(body: Buffer, headers: Headers): ReplyUsage {
  if (isEncoded(headers)) return null;
  return isEventStream(headers) ? streamUsage(readSse(body.toString("utf8"))) : usageFromJson(body);
}

/**
 * Usage of a live reply once it has ended. A stream is read by `sse` as it
 * went by (whatever the capture limit); any other body from the bounded copy,
 * which is null when the reply outgrew the limit. An encoded body has none.
 */
export function replyUsage(headers: Headers, sse: SseUsage | null, captured: Buffer | null): ReplyUsage {
  if (isEncoded(headers)) return null;
  if (sse !== null) return streamUsage(sse);
  return captured === null ? null : usageFromJson(captured);
}
