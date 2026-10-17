import { describe, expect, it } from "vitest";
import { createSseUsage, readSse, usageFromSse } from "../src/gateway/sse";
import { sseEvent } from "./gateway-helpers";

/**
 * TST-1: the SSE usage reader keeps only the message_start usage and the latest
 * message_delta usage, whatever the chunking, so pricing never needs the stream.
 */

const START = sseEvent("message_start", { message: { model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } } });
const DELTA = sseEvent("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } });
const WIRE = START + sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "héllo ✓ wörld" } }) + DELTA + sseEvent("message_stop", {});
const EXPECTED = { model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 0, cacheWrite1hTokens: 0, speed: "standard" };

const fed = (chunks: Buffer[]) => {
  const reader = createSseUsage();
  for (const chunk of chunks) reader.push(chunk);
  return reader.result();
};

describe("TST-1 SSE usage reader", () => {
  it("reads the whole stream at once", () => {
    expect(fed([Buffer.from(WIRE)])).toEqual(EXPECTED);
    expect(usageFromSse(WIRE)).toEqual(EXPECTED);
  });

  it("reads it byte by byte, across lines and inside multi-byte characters", () => {
    const bytes = Buffer.from(WIRE);
    expect(fed(Array.from(bytes, (_, i) => bytes.subarray(i, i + 1)))).toEqual(EXPECTED);
  });

  it("reads CRLF streams, data lines split over several lines, and a last event with no blank line", () => {
    const crlf = WIRE.replaceAll("\n", "\r\n");
    expect(usageFromSse(crlf)).toEqual(EXPECTED);
    const split = 'data: {"type":"message_start",\ndata: "message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":100,"output_tokens":1}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":7}}';
    expect(usageFromSse(split)).toMatchObject({ inputTokens: 100, outputTokens: 7 });
  });

  it("lets later delta fields win and ignores nulls, so a null never erases a count", () => {
    const wire = START + sseEvent("message_delta", { delta: {}, usage: { input_tokens: 120, output_tokens: 50, cache_read_input_tokens: null } }) + sseEvent("message_delta", { delta: {}, usage: { output_tokens: 60 } });
    expect(usageFromSse(wire)).toMatchObject({ inputTokens: 120, outputTokens: 60, cacheReadTokens: 10 });
  });

  it("returns null without a message_start, and is not fooled by junk", () => {
    expect(usageFromSse(DELTA)).toBeNull();
    expect(usageFromSse("")).toBeNull();
    expect(usageFromSse("data: not json\n\ndata: {\"type\":\"ping\"}\n\nevent: x\n\n: comment\n\n")).toBeNull();
    expect(usageFromSse(sseEvent("message_start", { message: { usage: {} } }))).toBeNull();
  });

  it("skips a single line far beyond any event, then carries on", () => {
    const huge = `data: ${"x".repeat(2 * 1024 * 1024)}\n\n`;
    expect(usageFromSse(huge + WIRE)).toEqual(EXPECTED);
    const bytes = Buffer.from(huge + WIRE);
    const chunks: Buffer[] = [];
    for (let at = 0; at < bytes.length; at += 65536) chunks.push(bytes.subarray(at, at + 65536));
    expect(fed(chunks)).toEqual(EXPECTED);
  });

  it("drops an event whose data lines add up to far more than any usage event", () => {
    const lines = Array.from({ length: 40 }, () => `data: ${"y".repeat(100_000)}`).join("\n");
    expect(usageFromSse(`${lines}\n\n${WIRE}`)).toEqual(EXPECTED);
  });

  it("reports the same result however often it is asked", () => {
    const reader = createSseUsage();
    reader.push(Buffer.from(WIRE));
    expect(reader.result()).toEqual(EXPECTED);
    expect(reader.result()).toEqual(EXPECTED);
    reader.push(Buffer.from(sseEvent("message_delta", { delta: {}, usage: { output_tokens: 999 } })));
    expect(reader.result()).toEqual(EXPECTED);
  });

  it("TST-1 errorOnly: an error event without a message_start is an upstream error; after a message_start, or without an error, it is not", () => {
    const error = sseEvent("error", { error: { type: "overloaded_error", message: "Overloaded" } });
    expect(readSse(error).errorOnly()).toBe(true);
    expect(readSse(error).result()).toBeNull();
    expect(readSse(START + error).errorOnly()).toBe(false);
    expect(readSse(DELTA).errorOnly()).toBe(false);
    expect(readSse(WIRE).errorOnly()).toBe(false);
    expect(readSse('data: {"type":"error"}').errorOnly()).toBe(true);
    expect(readSse('data: {"type":"error"').errorOnly()).toBe(false);
    const reader = createSseUsage();
    reader.push(Buffer.from(error.slice(0, 10)));
    reader.push(Buffer.from(error.slice(10)));
    expect(reader.errorOnly()).toBe(true);
  });
});
