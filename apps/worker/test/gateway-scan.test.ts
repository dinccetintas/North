import { describe, expect, it } from "vitest";
import { REDACTED_ADDRESS, REDACTED_BEARER, REDACTED_KEY, bodyTexts, holdsAnthropicKey, holdsOpenAddress, northTestAddresses, scrubCassette } from "../src/gateway/cassette";
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

  it("is the old pattern on 4,000 random strings built from the pieces that make it hard (inputs WITHOUT backslashes only: the scrubber reads JSON escapes, the old pattern did not)", () => {
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

/** A JSON string literal of raw text that is already escaped (`raw` must hold only valid escapes), decoded. */
const decode = (raw: string): string => JSON.parse(`"${raw}"`) as string;

describe("TST-2 the address scrub reads JSON escapes: the body it scrubs is JSON text, where \\n is one character", () => {
  it("an address after \\n, \\t, \\r, \\b, \\f or \\u00e9 keeps the escape whole and stays valid JSON", () => {
    for (const escape of ["\\n", "\\t", "\\r", "\\b", "\\f", "\\u00e9", "\\u0001", "\\\\"]) {
      const raw = `Contact:${escape}bob@north.test`;
      expect(scrubCassette(raw), raw).toBe(`Contact:${escape}redacted@north.test`);
      expect(decode(scrubCassette(raw)), raw).toBe(`${decode(`Contact:${escape}`)}redacted@north.test`);
    }
  });

  it("an escaped backslash is a backslash, not an escape: `\\\\nbob` is a backslash and the local part `nbob`", () => {
    expect(scrubCassette("a\\\\nbob@north.test")).toBe("a\\\\redacted@north.test");
    expect(scrubCassette("a\\\\\\nbob@north.test")).toBe("a\\\\\\nredacted@north.test");
  });

  it("one address per line, and two escapes in a row", () => {
    expect(scrubCassette("ana@north.test\\nbob@north.test\\ncy@north.test")).toBe("redacted@north.test\\nredacted@north.test\\nredacted@north.test");
    expect(scrubCassette("a\\n\\tbob@north.test")).toBe("a\\n\\tredacted@north.test");
    expect(scrubCassette("\\u00e9\\u00e9bob@north.test")).toBe("\\u00e9\\u00e9redacted@north.test");
  });

  it("an escape with nothing after it is not an address, and a non-ASCII letter ends the local part by itself", () => {
    expect(scrubCassette("a\\n@north.test")).toBe("a\\n@north.test");
    expect(scrubCassette("a\\u00e9@north.test")).toBe("a\\u00e9@north.test");
    expect(scrubCassette("xébob@north.test")).toBe("xéredacted@north.test");
  });

  it("plain text (a path, a header value) has no escapes: a backslash before a name is a backslash", () => {
    expect(scrubCassette("C:\\temp\\bob@north.test", "text")).toBe("C:\\temp\\redacted@north.test");
    expect(scrubCassette("C:\\temp\\bob@north.test", "json")).toBe("C:\\temp\\bredacted@north.test");
    expect(northTestAddresses("a\\nbob@north.test", "text").map((span) => span.local)).toEqual(["nbob"]);
    expect(northTestAddresses("a\\nbob@north.test", "json").map((span) => span.local)).toEqual(["bob"]);
  });

  it("is what the JSON means on 5,000 random JSON strings: decode, scrub with the old pattern, compare; and the output is valid JSON", () => {
    const pieces = ["a", "b", "x", "@", "@north.test", ".test", ".", "-", "_", "+", " ", "\\n", "\\t", "\\r", "\\u00e9", "\\u0001", "\\\\", "é", "redacted", "n", "t", "u00e9", "@north.testing"];
    let seed = 20261018;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    let withEscapes = 0;
    let changed = 0;
    for (let i = 0; i < 5000; i += 1) {
      const raw = Array.from({ length: 1 + (next() % 24) }, () => pieces[next() % pieces.length] ?? "").join("");
      const scrubbed = scrubCassette(raw);
      expect(decode(scrubbed), JSON.stringify(raw)).toBe(reference(decode(raw)));
      if (raw.includes("\\")) withEscapes += 1;
      if (scrubbed !== raw) changed += 1;
    }
    expect(withEscapes).toBeGreaterThan(3000);
    expect(changed).toBeGreaterThan(1000);
  });
});

describe("TST-2 holdsOpenAddress accepts exactly what the scrubber writes", () => {
  it("redacted@north.test, and two redactions that touch; not another address, not a longer local part", () => {
    expect(holdsOpenAddress("redacted@north.test")).toBe(false);
    expect(holdsOpenAddress(scrubCassette("a@north.test.b@north.test"))).toBe(false);
    expect(holdsOpenAddress(scrubCassette("a@north.test-b@north.test_c@north.test"))).toBe(false);
    expect(holdsOpenAddress("bob@north.test")).toBe(true);
    expect(holdsOpenAddress("xredacted@north.test")).toBe(true);
    expect(holdsOpenAddress("north.testredactedx@north.test")).toBe(true);
    expect(holdsOpenAddress("north.testbob@north.test")).toBe(true);
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

  it("a stream with CR-only line endings is read, and a block's opening text joins its deltas", () => {
    const crOnly = stream(delta(0, "text", "my key is sk-"), delta(0, "text", "ant-api03-AbCdEf")).toString().replaceAll("\n", "\r");
    expect(holdsAnthropicKey(Buffer.from(crOnly), SSE)).toBe(true);
    const start = (index: number, block: Record<string, unknown>) => sseEvent("content_block_start", { index, content_block: block });
    expect(holdsAnthropicKey(stream(start(0, { type: "text", text: "the key sk-" }), delta(0, "text", "ant-api03-AbCdEf")), SSE)).toBe(true);
    expect(holdsAnthropicKey(stream(start(0, { type: "thinking", thinking: "sk-" }), delta(0, "thinking", "ant-api03-AbCdEf")), SSE)).toBe(true);
    expect(holdsAnthropicKey(stream(start(0, { type: "text", text: "sk-" }), delta(1, "text", "ant-api03-AbCdEf")), SSE)).toBe(false);
    expect(holdsAnthropicKey(stream(start(0, { type: "tool_use", id: "t1", name: "x", input: {} }), delta(0, "partial_json", '{"a":1}')), SSE)).toBe(false);
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

  it("bodyTexts offers the raw bytes (JSON text), the JSON strings and each block's deltas joined (plain text)", () => {
    const readings = bodyTexts(stream(delta(0, "text", "ab"), delta(0, "text", "cd")), "text/event-stream");
    expect(readings.map((reading) => reading.text)).toContain("abcd");
    expect(readings[0]?.kind).toBe("json");
    expect(readings.slice(1).every((reading) => reading.kind === "text")).toBe(true);
    const decoded = bodyTexts(Buffer.from('{"a":"\\u0041"}'), "application/json");
    expect(decoded.some((reading) => reading.text.includes("A"))).toBe(true);
    expect(bodyTexts(Buffer.from("plain bytes"), "application/octet-stream")).toEqual([{ text: "plain bytes", kind: "text" }]);
  });

  it("reads a megabyte stream in linear time", () => {
    const many = stream(...Array.from({ length: 20_000 }, (_, i) => delta(i % 4, "text", "word word word word word ")));
    expect(timed(() => holdsAnthropicKey(many, SSE))).toBeLessThan(1000);
  });
});
