import { describe, expect, it } from "vitest";
import { REDACTED_ADDRESS, REDACTED_BEARER, REDACTED_KEY, bodyTexts, holdsAnthropicKey, northTestAddresses, scrubCassette } from "../src/gateway/cassette";
import { sseEvent } from "./gateway-helpers";

/**
 * TST-2: what the cassette code reads a body and a request for. The scrubber is
 * linear (it ran in quadratic time on a long unbroken run) and reads exactly
 * what the old pattern read; a reply that spells an Anthropic key in pieces,
 * across stream events or with JSON escapes, is still a reply that holds one.
 */

/** The scrubber's address pattern before it was made linear: the reference the fuzz test compares with. */
const reference = (text: string): string => text.replace(/[A-Za-z0-9._%+-]+@north\.test\b/gi, "redacted@north.test");

/** Wall-clock milliseconds `work` takes. */
function timed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe("TST-2 the address scrub is linear and reads what the old pattern read", () => {
  it("chained addresses: the second reaches back only to the end of the first", () => {
    const chained = "a@north.test.b@north.test";
    expect(scrubCassette(chained)).toBe(reference(chained));
    expect(scrubCassette(chained)).toBe("redacted@north.testredacted@north.test");
    expect(northTestAddresses(chained).map((span) => span.local)).toEqual(["a", ".b"]);
    expect(scrubCassette("x@north.test@north.test")).toBe("redacted@north.test@north.test");
  });

  it("a domain with no local part is left alone; a longer domain is not ours", () => {
    for (const text of ["@north.test", "mail @north.test now", "a@north.testing", "a@north.test2", "a@north.tests and b@north.test"]) expect(scrubCassette(text), text).toBe(reference(text));
    expect(northTestAddresses("@north.test")).toEqual([]);
  });

  it("any case, and a local part of every allowed character", () => {
    for (const text of ["Bob.O+tag_1%x-y@NORTH.TEST", "ANA@North.Test!", "(ana@north.test)", "a@north.test,b@north.test", "<a@north.test><b@north.test>"]) expect(scrubCassette(text), text).toBe(reference(text));
  });

  it("is the old pattern on 4,000 random strings built from the pieces that make it hard", () => {
    const pieces = ["a", "b", "x", "@", "@north.test", "north", ".test", ".", "-", "_", "%", "+", " ", "\n", "é", "redacted", "Redacted@NORTH.TEST", "1", "t", "@north.testing"];
    let seed = 20261017;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 4000; i += 1) {
      const text = Array.from({ length: 1 + (next() % 24) }, () => pieces[next() % pieces.length] ?? "").join("");
      const scrubbed = scrubCassette(text);
      expect(scrubbed, JSON.stringify(text)).toBe(reference(text).replace(/sk-ant-[A-Za-z0-9_-]+/g, REDACTED_KEY));
    }
  });

  it("reads a megabyte of one unbroken run in well under 200 ms, whatever follows it", () => {
    const run = "a".repeat(1_000_000);
    expect(timed(() => scrubCassette(run))).toBeLessThan(200);
    const withAddress = `${run}@north.test`;
    let scrubbed = "";
    expect(timed(() => (scrubbed = scrubCassette(withAddress)))).toBeLessThan(200);
    expect(scrubbed).toBe(REDACTED_ADDRESS);
    expect(timed(() => scrubCassette("a@north.test.".repeat(60_000)))).toBeLessThan(200);
    expect(timed(() => scrubCassette("a.".repeat(500_000) + "@north.testx".repeat(1000)))).toBeLessThan(200);
  });
});

describe("TST-2 the bearer scrub reads the scheme in any case, token-shaped only", () => {
  it("redacts Bearer, bearer and BEARER followed by a token of 16 or more characters", () => {
    for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) expect(scrubCassette(`${scheme} ghp_abcdefghijklmnopqrstuvwxyz0123`)).toBe(REDACTED_BEARER);
  });

  it("leaves plain English and short words alone, and its own marker", () => {
    const prose = "the bearer of this note may enter; bearer bonds pay; BEARER shortword; bearer of 15 chars";
    expect(scrubCassette(prose)).toBe(prose);
    expect(scrubCassette(REDACTED_BEARER)).toBe(REDACTED_BEARER);
  });
});

describe("TST-2 holdsAnthropicKey reads a reply the way its reader does", () => {
  const delta = (index: number, field: "text" | "partial_json" | "thinking", value: string) =>
    sseEvent("content_block_delta", { index, delta: { type: `${field === "partial_json" ? "input_json" : field}_delta`, [field]: value } });
  const stream = (...events: string[]): Buffer => Buffer.from([sseEvent("message_start", { message: { model: "claude-haiku-5-5", usage: {} } }), ...events, sseEvent("message_stop", {})].join(""));
  const SSE = { "content-type": "text/event-stream" };

  it("a key split across text deltas of one block is a key", () => {
    const split = stream(delta(0, "text", "my key is sk-"), delta(0, "text", "ant-api03-AbCdEf"));
    expect(holdsAnthropicKey(split, SSE)).toBe(true);
    expect(holdsAnthropicKey(split)).toBe(true);
  });

  it("so is one split across tool-input fragments or thinking deltas, in three pieces", () => {
    expect(holdsAnthropicKey(stream(delta(1, "partial_json", '{"k":"sk'), delta(1, "partial_json", "-ant"), delta(1, "partial_json", '-api03-AbCd"}')), SSE)).toBe(true);
    expect(holdsAnthropicKey(stream(delta(2, "thinking", "sk-a"), delta(2, "thinking", "nt-xyz")), SSE)).toBe(true);
  });

  it("a delta with no index (never on the wire, but a file can be written by hand) is read as one block, not skipped", () => {
    const event = (text: string) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`;
    expect(holdsAnthropicKey(Buffer.from(event("sk-") + event("ant-api03-AbCdEf123")), SSE)).toBe(true);
  });

  it("pieces of different blocks are not joined, and a stream with no key is clean", () => {
    expect(holdsAnthropicKey(stream(delta(0, "text", "sk-"), delta(1, "text", "ant-api03-AbCd")), SSE)).toBe(false);
    expect(holdsAnthropicKey(stream(delta(0, "text", "sk-"), delta(0, "text", "ant-")), SSE)).toBe(false);
    expect(holdsAnthropicKey(stream(delta(0, "text", "Hello "), delta(0, "text", "world.")), SSE)).toBe(false);
  });

  it("a key spelled with JSON escapes is a key, in a plain reply and in a stream", () => {
    expect(holdsAnthropicKey(Buffer.from('{"content":[{"type":"text","text":"\\u0073k-ant-api03-AbCd"}]}'), { "content-type": "application/json" })).toBe(true);
    expect(holdsAnthropicKey(stream(delta(0, "text", "\\u0073k-ant-api03-AbCd".replace("\\u0073", "s"))), SSE)).toBe(true);
    expect(holdsAnthropicKey(Buffer.from('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\\u0073k-ant-api03-AbCd"}}\n\n'), SSE)).toBe(true);
    expect(holdsAnthropicKey(Buffer.from('{"text":"\\u0073k-ant- is a prefix"}'))).toBe(false);
  });

  it("a header value still counts, and a stream that is not JSON does not throw", () => {
    expect(holdsAnthropicKey(Buffer.from("{}"), { "x-echo": ["fine", "sk-ant-api03-xyz"] })).toBe(true);
    expect(holdsAnthropicKey(Buffer.from("event: ping\ndata: not json\n\ndata: [DONE]\n\n"), SSE)).toBe(false);
  });

  it("bodyTexts offers the raw bytes, the JSON strings and each block's deltas joined", () => {
    const texts = bodyTexts(stream(delta(0, "text", "ab"), delta(0, "text", "cd")), "text/event-stream");
    expect(texts).toContain("abcd");
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(bodyTexts(Buffer.from('{"a":"\\u0041"}'), "application/json").some((text) => text.includes("A"))).toBe(true);
  });

  it("reads a megabyte stream in linear time", () => {
    const many = stream(...Array.from({ length: 20_000 }, (_, i) => delta(i % 4, "text", "word word word word word ")));
    expect(timed(() => holdsAnthropicKey(many, SSE))).toBeLessThan(1000);
  });
});
