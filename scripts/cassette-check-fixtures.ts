/**
 * TST-2: shared fixtures of the cassette check tests (`cassette-check*.test.ts`).
 * A cassette is recorded with the gateway's own `writeCassette`, so the writer
 * and the checker are tested against each other; a test then breaks the file
 * the way a hand edit, a rename or a stale recording would.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cassetteKey, writeCassette } from "../apps/worker/src/gateway/cassette";

export const PIN = "0.3.301";
export const SDK_AGENT = "claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.3.301)";
export const PATH = "/v1/messages?beta=true";
export const BETA = "interleaved-thinking-2025-05-14";
const AT = () => new Date("2026-10-17T09:00:00.000Z");

export const requestBody = (extra: Record<string, unknown> = {}) => ({ model: "claude-haiku-5-5", max_tokens: 64, messages: [{ role: "user", content: "Write one line about the company." }], ...extra });
export const keyFor = (body: unknown) => cassetteKey({ path: PATH, betaHeader: BETA, body });

/** A recorded file as it is on disk. */
export interface Recorded {
  readonly key: string;
  readonly name: string;
  readonly text: string;
}

/** A cassette file as parsed JSON, for tests that break one field (any extra field is allowed, to be refused). */
export interface CassetteJson {
  key: string;
  request: { method: string; path: string; headers: Record<string, string>; body: string };
  response: { status: number; headers: Record<string, string>; body: string };
  meta?: Record<string, unknown>;
  [extra: string]: unknown;
}

/** A fresh temp directory; remove it with {@link removeDir}. */
export const makeDir = (): Promise<string> => mkdtemp(join(tmpdir(), "north-cassette-check-"));
export const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true });
export const makeSubdir = async (dir: string, name: string): Promise<void> => {
  await mkdir(join(dir, name));
};

/** Records one exchange into `dir` with the gateway's writer (a reply of `replyBody` and `replyHeaders`) and returns the file as it is on disk. */
export async function recordIn(
  dir: string,
  body: Record<string, unknown> = requestBody(),
  userAgent: string = SDK_AGENT,
  reply: { body?: string; headers?: Record<string, string> } = {},
): Promise<Recorded> {
  const key = keyFor(body);
  const headers = { "user-agent": userAgent, "anthropic-beta": BETA, "content-type": "application/json" };
  const response = { status: 200, headers: reply.headers ?? { "content-type": "application/json" }, body: Buffer.from(reply.body ?? '{"content":[{"type":"text","text":"A line."}]}') };
  await writeCassette(dir, key, response, { method: "POST", path: PATH, headers, body: Buffer.from(JSON.stringify(body)) }, AT);
  return { key, name: `${key}.json`, text: await readFile(join(dir, `${key}.json`), "utf8") };
}

export const parsed = (file: Recorded): CassetteJson => JSON.parse(file.text) as CassetteJson;

/** The file with one field changed (re-serialised). */
export const edited = (file: Recorded, change: (json: CassetteJson) => void): Recorded => {
  const json = parsed(file);
  change(json);
  return { ...file, text: `${JSON.stringify(json, null, 2)}\n` };
};

/** The file's text with `change` applied to the serialised JSON: for what `JSON.stringify` would not write (`\u` escapes). */
export const editedText = (file: Recorded, change: (text: string) => string): Recorded => ({ ...file, text: change(file.text) });

export const b64 = (text: string): string => Buffer.from(text).toString("base64");
export const putIn = (dir: string, file: Recorded): Promise<void> => writeFile(join(dir, file.name), file.text);
