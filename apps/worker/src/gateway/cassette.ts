// TST-2: cassettes for the model gateway. A cassette is one recorded exchange
// (request and response) stored as `<dir>/<key>.json`, where the key hashes the
// request after the parts that change between runs are normalised. Cassettes
// are committed: the stored request is scrubbed (`scrubCassette`), the stored
// response is kept verbatim so replay serves exactly what was recorded, and a
// response that holds an Anthropic key is refused outright. A recording also
// carries a `meta` block (SDK version, time, whether scrubbing changed the
// request) that `scripts/cassette-check.ts` reads.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const KeySchema = z.string().regex(/^[0-9a-f]{64}$/, "a cassette key is a sha256 hex digest");

// ---- the key ----------------------------------------------------------------

// Not `\b`: an id after an underscore (`session_<uuid>`) must still be found. Any version or variant.
const UUID = /(?<![0-9A-Za-z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z])/gi;
const ISO_TIMESTAMP = /(?<![0-9A-Za-z])\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const TASK_ID_LINE = /^Task id: .*$/gm;

/** What changes between two runs of the same test, replaced by a fixed placeholder. */
function normalise(text: string): string {
  return text.replace(TASK_ID_LINE, "Task id: <id>").replace(UUID, "<uuid>").replace(ISO_TIMESTAMP, "<timestamp>");
}

/** JSON with object keys sorted at every depth and every string normalised (keys are kept as they are). */
function canonicalJson(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(normalise(value));
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * What a cassette key is made of: the request target (path and query), the
 * `anthropic-beta` header value, and the parsed JSON body.
 */
export interface CassetteKeyInput {
  /** Path and query as forwarded, e.g. `/v1/messages?beta=true`. */
  readonly path: string;
  /** The `anthropic-beta` header value, possibly several flags; "" when there is none. */
  readonly betaHeader: string;
  readonly body: unknown;
}

/** The beta flags of a header value, trimmed, sorted and comma-joined: the order a caller lists them in does not matter. */
const normaliseBeta = (header: string): string =>
  header
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag !== "")
    .sort()
    .join(",");

/**
 * The cassette key of a request: the sha256 hex of the canonical JSON (keys
 * sorted recursively) of `{ path, betaHeader, body }`, after UUIDs (any
 * version), ISO-8601 date-times and `Task id: …` lines are replaced by
 * placeholders in every string, and the beta flags are sorted. Two runs of the
 * same test therefore share a key; any other change to the request, including
 * its path or its beta flags, does not.
 */
export function cassetteKey(input: CassetteKeyInput): string {
  return createHash("sha256").update(canonicalJson({ path: input.path, betaHeader: normaliseBeta(input.betaHeader), body: input.body })).digest("hex");
}

// ---- scrubbing --------------------------------------------------------------

const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]+/g;
// The scheme is spelled `Bearer`, followed by a long token: plain English ("the bearer of this note") stays.
const BEARER_TOKEN = /Bearer [A-Za-z0-9._~+/-]{16,}=*/g;
// An address is one or more LOCAL_PART_CHAR and then the domain. It is found from the domain backwards,
// never as `<local>@north.test` in one pattern: with the local part first, a long unbroken run of
// local-part characters (a base64 body, a minified blob) is re-read from every position and the scrub
// is quadratic. LOCAL_PART_CHAR has no `g` flag, so `test` keeps no state.
const NORTH_TEST_DOMAIN = /@north\.test\b/gi;
const LOCAL_PART_CHAR = /[A-Za-z0-9._%+-]/;
const REDACTED_ADDRESS = "redacted@north.test";

/** Matches one Anthropic key (no `g` flag, so `test` keeps no state). */
const ANTHROPIC_KEY_ONCE = /sk-ant-[A-Za-z0-9_-]+/;

/**
 * Where the local part of the address whose `@` sits at `at` begins: the start
 * of the run of local-part characters right before it, but never before
 * `floor`, the end of the address redacted last (a local part cannot reach into
 * it). Returns `at` itself when no local-part character precedes the `@`: a
 * bare domain is no address.
 */
function localPartStart(text: string, at: number, floor: number): number {
  let start = at;
  while (start > floor && LOCAL_PART_CHAR.test(text.charAt(start - 1))) start -= 1;
  return start;
}

/**
 * Every `<local>@north.test` replaced by `redacted@north.test`: exactly the
 * matches of `/[A-Za-z0-9._%+-]+@north\.test\b/gi` (left to right, the local
 * part as long as it can be, never reaching into an earlier match), found in
 * one pass over the text: each domain first, then its local part walked
 * backwards once. Returns `text` itself when there is nothing to redact.
 */
function redactNorthTestAddresses(text: string): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(NORTH_TEST_DOMAIN)) {
    const start = localPartStart(text, match.index, cursor);
    if (start === match.index) continue;
    pieces.push(text.slice(cursor, start), REDACTED_ADDRESS);
    cursor = match.index + match[0].length;
  }
  return pieces.length === 0 ? text : `${pieces.join("")}${text.slice(cursor)}`;
}

/**
 * Removes what must never be committed from a request: Anthropic keys, bearer
 * tokens (`Bearer` and a token of 16 or more characters) and email addresses
 * under `@north.test`. Idempotent; the replacements keep JSON strings valid.
 * Linear in the length of `text`, so a multi-megabyte body never stalls the
 * gateway's event loop while it records.
 */
export function scrubCassette(text: string): string {
  return redactNorthTestAddresses(text.replace(ANTHROPIC_KEY, "sk-ant-REDACTED").replace(BEARER_TOKEN, "Bearer REDACTED"));
}

/** latin1 maps bytes 1:1 to characters, so scrubbing never alters the other bytes of a request body. */
const scrubBody = (body: Buffer): Buffer => Buffer.from(scrubCassette(body.toString("latin1")), "latin1");

// ---- the file ---------------------------------------------------------------

/** Canonical base64 (a regex over megabytes of it would be slow); the empty string is an empty body. */
const Base64 = z.string().refine((text) => Buffer.from(text, "base64").toString("base64") === text, "not base64");
const HeadersSchema = z.record(z.string(), z.string());

/**
 * What a recording says about itself, written by `writeCassette` and read by
 * `scripts/cassette-check.ts`. Optional in the file so a cassette recorded
 * before this block existed still replays.
 */
const MetaSchema = z.object({
  /** The Agent SDK version the request's user agent names (`agent-sdk/<version>`); null for any other client. */
  sdkVersion: z.string().nullable(),
  /** When the exchange was recorded (ISO-8601, UTC). */
  recordedAt: z.iso.datetime(),
  /** True when scrubbing changed the body, path or `anthropic-beta` header, so the key cannot be recomputed from the stored request. */
  requestScrubbed: z.boolean(),
  /** Only the `record` mode writes a cassette. */
  gatewayMode: z.literal("record"),
});

/** The shape of a cassette file on disk; the cassette check validates every file against it. */
export const CassetteFileSchema = z.object({
  key: KeySchema,
  request: z.object({ method: z.string(), path: z.string(), headers: HeadersSchema, body: Base64 }),
  response: z.object({ status: z.number().int().min(100).max(599), headers: HeadersSchema, body: Base64 }),
  meta: MetaSchema.optional(),
});
export type CassetteFile = z.infer<typeof CassetteFileSchema>;
export type CassetteMeta = z.infer<typeof MetaSchema>;

// `agent-sdk/<semver>` as its own field of the user agent's parenthesis: `claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.3.301[, client-app/..][, workload/..])`.
// The Agent SDK sets CLAUDE_AGENT_SDK_VERSION for the Claude Code subprocess, which adds the field. `claude-cli/<n>` is the CLI's own version, not the SDK's.
const AGENT_SDK_FIELD = /[(,]\s*agent-sdk\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*(?=[,)])/;

/** The Agent SDK version a user agent names, or null when it names none (the CLI alone, the API client, no header). */
export function sdkVersionOf(userAgent: string | null | undefined): string | null {
  return AGENT_SDK_FIELD.exec(userAgent ?? "")?.[1] ?? null;
}

/** Headers as Node hands them over: a repeated header may be an array. */
export type HeaderInput = Readonly<Record<string, string | string[] | undefined>>;

/** One side of a recorded exchange as the gateway replays it: `readCassette` returns plain-string headers. */
export interface CassetteResponse {
  readonly status: number;
  readonly headers: HeaderInput;
  readonly body: Buffer;
}

/** The request a response answers, kept for review (never used to match). */
export interface CassetteRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: HeaderInput;
  readonly body: Buffer;
}

/** Request headers that carry a credential: never stored. */
const SECRET_REQUEST_HEADERS: ReadonlySet<string> = new Set(["x-api-key", "authorization"]);
/** Response headers that identify the account, set state, or describe the wire (the replay computes its own length): never stored. */
const DROPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set(["set-cookie", "anthropic-organization-id", "content-length", "transfer-encoding", "connection", "keep-alive"]);

/** Lower-cased, multi-values joined; the names in `dropped` are left out; values are passed through `clean`. */
function cleanHeaders(headers: HeaderInput, dropped: ReadonlySet<string>, clean: (value: string) => string): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || dropped.has(lower)) continue;
    kept[lower] = clean(Array.isArray(value) ? value.join(", ") : String(value));
  }
  return kept;
}

/**
 * True when the body (or a header value) holds something shaped like an
 * Anthropic key. A response like that is never recorded: unlike a request, it
 * cannot be scrubbed without changing what replay serves.
 */
export function holdsAnthropicKey(body: Buffer, headers: HeaderInput = {}): boolean {
  const headerText = Object.values(headers).flat().join("\n");
  return ANTHROPIC_KEY_ONCE.test(body.toString("latin1")) || ANTHROPIC_KEY_ONCE.test(headerText);
}

const fileOf = (dir: string, key: string): string => join(dir, `${KeySchema.parse(key)}.json`);

/** The stored form of a request: scrubbed, with the credential headers gone. */
interface StoredRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

function storedRequestOf(request: CassetteRequest): StoredRequest {
  return { method: request.method, path: scrubCassette(request.path), headers: cleanHeaders(request.headers, SECRET_REQUEST_HEADERS, scrubCassette), body: scrubBody(request.body) };
}

/**
 * True when scrubbing changed a part a key is made of (the body, the path or the
 * `anthropic-beta` header): the key of such a recording cannot be recomputed
 * from the stored request, and the cassette check skips that comparison.
 */
function keyPartsScrubbed(request: CassetteRequest, stored: StoredRequest): boolean {
  const rawBeta = cleanHeaders(request.headers, SECRET_REQUEST_HEADERS, (value) => value)["anthropic-beta"];
  return !stored.body.equals(request.body) || stored.path !== request.path || stored.headers["anthropic-beta"] !== rawBeta;
}

/**
 * Stores one exchange as `<dir>/<key>.json`, both bodies base64. The request
 * is scrubbed (body, path and header values) and loses its key headers. The
 * response is stored verbatim, so replay serves exactly what was recorded; it
 * loses only its account and wire headers, and a response that holds an
 * Anthropic key is refused (throws, writes nothing). A `meta` block records the
 * SDK version (from the stored `user-agent`), the time (`now`, the wall clock by
 * default) and whether scrubbing changed the key's inputs. The write goes to a
 * temp file and is renamed into place, so a reader never sees half a file.
 * Throws when `key` is not a sha256 hex digest.
 */
export async function writeCassette(dir: string, key: string, response: CassetteResponse, request: CassetteRequest, now: () => Date = () => new Date()): Promise<void> {
  const target = fileOf(dir, key);
  if (holdsAnthropicKey(response.body, response.headers)) throw new Error("refusing to record a response that holds an Anthropic key");
  const stored = storedRequestOf(request);
  const meta: CassetteMeta = { sdkVersion: sdkVersionOf(stored.headers["user-agent"]), recordedAt: now().toISOString(), requestScrubbed: keyPartsScrubbed(request, stored), gatewayMode: "record" };
  const file: CassetteFile = {
    key,
    request: { ...stored, body: stored.body.toString("base64") },
    response: { status: response.status, headers: cleanHeaders(response.headers, DROPPED_RESPONSE_HEADERS, (value) => value), body: response.body.toString("base64") },
    meta,
  };
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${key}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { flag: "wx" });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * The recorded response for `key`, or null when there is none. A file that
 * exists but is not a valid cassette for that key throws: replaying garbage
 * would hide a broken recording.
 */
export async function readCassette(dir: string, key: string): Promise<CassetteResponse | null> {
  const target = fileOf(dir, key);
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`cassette ${key}.json is malformed: not JSON`);
  }
  const parsed = CassetteFileSchema.safeParse(raw);
  if (!parsed.success || parsed.data.key !== key) throw new Error(`cassette ${key}.json is malformed: ${parsed.success ? "its key does not match its name" : parsed.error.issues[0]?.message ?? "invalid"}`);
  const { status, headers, body } = parsed.data.response;
  return Object.freeze({ status, headers: Object.freeze({ ...headers }), body: Buffer.from(body, "base64") });
}
