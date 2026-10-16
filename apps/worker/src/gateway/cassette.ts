// TST-2: cassettes for the model gateway. A cassette is one recorded exchange
// (request and response) stored as `<dir>/<key>.json`, where the key hashes the
// request after the parts that change between runs are normalised. Cassettes
// are committed, so everything written passes through `scrubCassette` first.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const KeySchema = z.string().regex(/^[0-9a-f]{64}$/, "a cassette key is a sha256 hex digest");

// ---- the key ----------------------------------------------------------------

// Not `\b`: an id after an underscore (`session_<uuid>`) must still be found.
const UUID_V4 = /(?<![0-9A-Za-z])[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9A-Za-z])/gi;
const ISO_TIMESTAMP = /(?<![0-9A-Za-z])\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const TASK_ID_LINE = /^Task id: .*$/gm;

/** What changes between two runs of the same test, replaced by a fixed placeholder. */
function normalise(text: string): string {
  return text.replace(TASK_ID_LINE, "Task id: <id>").replace(UUID_V4, "<uuid>").replace(ISO_TIMESTAMP, "<timestamp>");
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
 * The cassette key of a request body: the sha256 hex of its canonical JSON
 * (keys sorted recursively) after UUIDs (v4 shape), ISO-8601 date-times and
 * `Task id: …` lines are replaced by placeholders in every string. Two runs of
 * the same test therefore share a key; any other change to the request does not.
 */
export function cassetteKey(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

// ---- scrubbing --------------------------------------------------------------

const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]+/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const NORTH_TEST_EMAIL = /[A-Za-z0-9._%+-]+@north\.test\b/gi;

/**
 * Removes what must never be committed: Anthropic keys, bearer tokens and
 * email addresses under `@north.test`. Idempotent; the replacements keep JSON
 * strings valid.
 */
export function scrubCassette(text: string): string {
  return text.replace(ANTHROPIC_KEY, "sk-ant-REDACTED").replace(BEARER_TOKEN, "Bearer REDACTED").replace(NORTH_TEST_EMAIL, "redacted@north.test");
}

/** latin1 maps bytes 1:1 to characters, so scrubbing never alters the other bytes of a body. */
const scrubBody = (body: Buffer): Buffer => Buffer.from(scrubCassette(body.toString("latin1")), "latin1");

// ---- the file ---------------------------------------------------------------

/** Canonical base64 (a regex over megabytes of it would be slow); the empty string is an empty body. */
const Base64 = z.string().refine((text) => Buffer.from(text, "base64").toString("base64") === text, "not base64");
const HeadersSchema = z.record(z.string(), z.string());

const CassetteFileSchema = z.object({
  key: KeySchema,
  request: z.object({ method: z.string(), path: z.string(), headers: HeadersSchema, body: Base64 }),
  response: z.object({ status: z.number().int().min(100).max(599), headers: HeadersSchema, body: Base64 }),
});

/** Headers as Node hands them over: a repeated header may be an array. */
type HeaderInput = Readonly<Record<string, string | readonly string[] | undefined>>;

/** A recorded response, as the gateway replays it (`headers` come back as plain strings). */
export interface CassetteResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

/** A response to record: the same, with headers as they arrived. */
export interface RecordedResponse {
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
/** Response headers that identify the account, set state, or describe the wire (the stored body is scrubbed, so its length changes): never stored. */
const DROPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set(["set-cookie", "anthropic-organization-id", "content-length", "transfer-encoding", "connection", "keep-alive"]);

/** Lower-cased, multi-values joined, scrubbed; the names in `dropped` are left out. */
function cleanHeaders(headers: HeaderInput, dropped: ReadonlySet<string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || dropped.has(lower)) continue;
    clean[lower] = scrubCassette(Array.isArray(value) ? value.join(", ") : String(value));
  }
  return clean;
}

const fileOf = (dir: string, key: string): string => join(dir, `${KeySchema.parse(key)}.json`);

/**
 * Stores one exchange as `<dir>/<key>.json`: the request without its key
 * headers, the full response, both bodies base64 and scrubbed. The write goes
 * to a temp file and is renamed into place, so a reader never sees half a file.
 * Throws when `key` is not a sha256 hex digest.
 */
export async function writeCassette(dir: string, key: string, response: RecordedResponse, request: CassetteRequest): Promise<void> {
  const target = fileOf(dir, key);
  const file = {
    key,
    request: { method: request.method, path: scrubCassette(request.path), headers: cleanHeaders(request.headers, SECRET_REQUEST_HEADERS), body: scrubBody(request.body).toString("base64") },
    response: { status: response.status, headers: cleanHeaders(response.headers, DROPPED_RESPONSE_HEADERS), body: scrubBody(response.body).toString("base64") },
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
