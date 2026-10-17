// TST-2: what the cassette code reads a body and a request for. One module
// holds the secret patterns, the redaction markers, the scrubber and the
// "does this reply hold a key" test, so the gateway (which scrubs a request and
// refuses to record a reply) and `scripts/cassette-check.ts` (which scans every
// committed file) read the same things the same way. Everything here is linear
// in the size of its input: bodies reach 8 MB and arrive from the open web.
import { z } from "zod";

// ---- the patterns and the markers a scrub leaves behind -------------------------

/** What an Anthropic key becomes. */
export const REDACTED_KEY = "sk-ant-REDACTED";
/** What a bearer token becomes. */
export const REDACTED_BEARER = "Bearer REDACTED";
/** What an address under `@north.test` becomes. */
export const REDACTED_ADDRESS = "redacted@north.test";
/** The local parts the scrubber writes: `redacted`, and, for two addresses that touched (`a@north.test.b@north.test`), `north.testredacted` (the first redaction's domain, then the second's local part). */
const REDACTED_LOCAL_PARTS: ReadonlySet<string> = new Set(["redacted", "north.testredacted"]);

/** An Anthropic key of any shape. Global: for `replace`; use `holdsAnthropicKey` or `.replace(...) !== text` to test, never `.test` (it keeps state). */
export const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]+/g;
/** A bearer token: the scheme in any case, then a token of 16 or more characters ("the bearer of this note" stays). Global, like {@link ANTHROPIC_KEY}. */
export const BEARER_TOKEN = /bearer [A-Za-z0-9._~+/-]{16,}=*/gi;
/** Matches one Anthropic key (no `g` flag, so `test` keeps no state). */
const ANTHROPIC_KEY_ONCE = /sk-ant-[A-Za-z0-9_-]+/;

const NORTH_TEST_DOMAIN = /@north\.test\b/gi;

/** A character of the local part of an address (`[A-Za-z0-9._%+-]`), by code unit. */
function isLocalPartChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 46 || code === 95 || code === 37 || code === 43 || code === 45;
}

/** One address under `@north.test` in a text: where it starts and ends, and its local part. */
export interface AddressSpan {
  readonly start: number;
  readonly end: number;
  readonly local: string;
}

/** What a text is: `json` is the raw text of a JSON document (a request body), where `\n` is one character; `text` is plain (a path, a header value, a decoded string). */
export type TextKind = "json" | "text";

const BACKSLASH = 92;
const SINGLE_ESCAPE_LETTERS = "ntrbf";
const FOUR_HEX = /^[0-9A-Fa-f]{4}$/;

/**
 * Where the local part really starts when `start` is the first local-part
 * character of a run in JSON text. Right after an escape (`\n`, `\t`, `\r`,
 * `\b`, `\f`: a backslash with an odd run of backslashes before it, so not an
 * escaped backslash) the run begins with the escape's letter, or with `uXXXX`;
 * those belong to the escape, not to the address (`bob` in `\nbob@north.test`,
 * not `nbob`). The scan stops at `floor`, the end of the previous address.
 */
function afterEscape(text: string, start: number, end: number, floor: number): number {
  if (start <= floor || text.charCodeAt(start - 1) !== BACKSLASH) return start;
  let backslashes = 0;
  for (let i = start - 1; i >= floor && text.charCodeAt(i) === BACKSLASH; i -= 1) backslashes += 1;
  if (backslashes % 2 === 0) return start;
  const letter = text.charAt(start);
  if (SINGLE_ESCAPE_LETTERS.includes(letter)) return start + 1;
  return letter === "u" && start + 5 <= end && FOUR_HEX.test(text.slice(start + 1, start + 5)) ? start + 5 : start;
}

/**
 * Every address under `@north.test` in `text`: the run of local-part
 * characters before each `@north.test`, never reaching back past the end of the
 * previous address (so `a@north.test.b@north.test` is `a@north.test` and
 * `.b@north.test`). A domain with no local part is not an address. This is
 * `/[A-Za-z0-9._%+-]+@north\.test\b/gi` found from the domain backwards:
 * that pattern is quadratic on a long unbroken run of local-part characters
 * (a base64 body, a minified blob), this reads each character once. In `json`
 * text a JSON escape ends the run (see {@link afterEscape}).
 */
export function northTestAddresses(text: string, kind: TextKind = "text"): readonly AddressSpan[] {
  const spans: AddressSpan[] = [];
  let floor = 0;
  for (const match of text.matchAll(NORTH_TEST_DOMAIN)) {
    const at = match.index;
    let start = at;
    while (start > floor && isLocalPartChar(text.charCodeAt(start - 1))) start -= 1;
    if (kind === "json") start = afterEscape(text, start, at, floor);
    if (start === at) continue;
    const end = at + match[0].length;
    spans.push(Object.freeze({ start, end, local: text.slice(start, at) }));
    floor = end;
  }
  return spans;
}

/** True when `text` (of the given `kind`, plain by default) holds an address under `@north.test` that the scrubber did not write (see {@link REDACTED_LOCAL_PARTS}). */
export const holdsOpenAddress = (text: string, kind: TextKind = "text"): boolean => northTestAddresses(text, kind).some((span) => !REDACTED_LOCAL_PARTS.has(span.local));

/** `text` with every address under `@north.test` replaced by {@link REDACTED_ADDRESS}. */
function redactAddresses(text: string, kind: TextKind): string {
  const spans = northTestAddresses(text, kind);
  if (spans.length === 0) return text;
  let out = "";
  let last = 0;
  for (const span of spans) {
    out += text.slice(last, span.start) + REDACTED_ADDRESS;
    last = span.end;
  }
  return out + text.slice(last);
}

/**
 * Removes what must never be committed from a request: Anthropic keys, bearer
 * tokens (the scheme in any case and a token of 16 or more characters) and
 * email addresses under `@north.test`. `kind` says what `text` is: `json` (the
 * default) is the raw text of a JSON body, whose escapes the address scrub
 * respects (`"Contact:\nbob@north.test"` keeps its newline); `text` is a path
 * or a header value. Linear; the replacements keep JSON strings valid. A second
 * pass over its own output changes nothing for ordinary text (two addresses
 * glued together, `a@north.test.b@north.test`, leave `...testredacted@north.test`,
 * which a second pass redacts again).
 */
export function scrubCassette(text: string, kind: TextKind = "json"): string {
  return redactAddresses(text.replace(ANTHROPIC_KEY, REDACTED_KEY).replace(BEARER_TOKEN, REDACTED_BEARER), kind);
}

// ---- reading a body ------------------------------------------------------------

/** Headers as Node hands them over: a repeated header may be an array. */
export type HeaderInput = Readonly<Record<string, string | string[] | undefined>>;

/** The media type line of a message (lower-cased, any header case), or "". */
function contentTypeOf(headers: HeaderInput): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "content-type") return (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).toLowerCase();
  }
  return "";
}

/** Every string a parsed JSON value holds, keys included, depth-first without recursion (a deep body cannot overflow the stack). */
function jsonStrings(root: unknown): string[] {
  const found: string[] = [];
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") found.push(value);
    else if (Array.isArray(value)) for (const item of value) pending.push(item);
    else if (value !== null && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) {
        found.push(name);
        pending.push(item);
      }
    }
  }
  return found;
}

const EVENT_LINE = /^\s*(event|data|id|retry):/;

/** The JSON payload of every event of an SSE body (an event whose data is not JSON is skipped). */
function sseEvents(text: string): unknown[] {
  const events: unknown[] = [];
  let data: string[] = [];
  const flush = (): void => {
    if (data.length === 0) return;
    try {
      events.push(JSON.parse(data.join("\n")) as unknown);
    } catch {
      // Not a JSON event: nothing a key could be assembled from.
    }
    data = [];
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === "") flush();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  flush();
  return events;
}

// `index` is always there on the wire; a stream without one is read as a single block, not skipped.
const BlockEventSchema = z.object({
  type: z.enum(["content_block_start", "content_block_delta"]),
  index: z.number().int().optional(),
  delta: z.record(z.string(), z.unknown()).optional(),
  content_block: z.record(z.string(), z.unknown()).optional(),
});
/** The fields a streamed reply spells its content in: text, tool input JSON and thinking. */
const CONTENT_FIELDS: readonly string[] = ["text", "partial_json", "thinking"];

/**
 * Each content block's streamed text joined in arrival order, grouped by the
 * block's `index`: what a block opens with (`content_block_start`) and its
 * `text`, `partial_json` and `thinking` deltas. It is the text the reader of a
 * stream sees: a key split across events (`"sk-"` then `"ant-api03-..."`) is
 * whole here.
 */
function joinedDeltas(events: readonly unknown[]): string[] {
  const blocks = new Map<number, string>();
  for (const event of events) {
    const parsed = BlockEventSchema.safeParse(event);
    if (!parsed.success) continue;
    const source = parsed.data.type === "content_block_start" ? parsed.data.content_block : parsed.data.delta;
    const piece = CONTENT_FIELDS.map((field) => source?.[field]).find((value): value is string => typeof value === "string");
    const index = parsed.data.index ?? -1;
    if (piece !== undefined) blocks.set(index, (blocks.get(index) ?? "") + piece);
  }
  return [...blocks.values()];
}

const isEventStream = (contentType: string, raw: string): boolean => contentType.startsWith("text/event-stream") || EVENT_LINE.test(raw.slice(0, 64));

const looksLikeJson = (raw: string): boolean => /^\s*[{["]/.test(raw.slice(0, 64));

/** One reading of a body, and what kind of text it is (see {@link TextKind}). */
export interface BodyText {
  readonly text: string;
  readonly kind: TextKind;
}

/**
 * The texts a secret can hide in, for one body: the bytes as latin1 characters
 * (one character per byte, so no byte hides from an ASCII pattern; `json` when
 * the body is a JSON document or a stream of JSON events, whose escapes are
 * then respected); every string of its JSON once parsed (so `\u0073k-ant-...`
 * is read as the key it is); and, for a Server-Sent Events body (by
 * `contentType` or by its first line), each content block's text joined, so a
 * key split across events is whole in one of them. The parsed readings are
 * plain `text`.
 */
export function bodyTexts(body: Buffer, contentType = ""): readonly BodyText[] {
  const raw = body.toString("latin1");
  const stream = isEventStream(contentType, raw);
  const json = looksLikeJson(raw);
  const texts: BodyText[] = [{ text: raw, kind: stream || json ? "json" : "text" }];
  const plain = (text: string): BodyText => ({ text, kind: "text" });
  if (stream) {
    const events = sseEvents(body.toString("utf8"));
    texts.push(plain(jsonStrings(events).join("\n")), ...joinedDeltas(events).map(plain));
  } else if (json) {
    try {
      texts.push(plain(jsonStrings(JSON.parse(body.toString("utf8")) as unknown).join("\n")));
    } catch {
      // Not JSON after all: the raw text is all there is.
    }
  }
  return texts;
}

/**
 * True when the body (or a header value) holds something shaped like an
 * Anthropic key, including one that a stream spells in pieces or JSON spells
 * with escapes (see {@link bodyTexts}). A response like that is never
 * recorded: unlike a request, it cannot be scrubbed without changing what
 * replay serves.
 */
export function holdsAnthropicKey(body: Buffer, headers: HeaderInput = {}): boolean {
  const headerText = Object.values(headers).flat().join("\n");
  return ANTHROPIC_KEY_ONCE.test(headerText) || bodyTexts(body, contentTypeOf(headers)).some((reading) => ANTHROPIC_KEY_ONCE.test(reading.text));
}
