import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CassetteFileSchema, cassetteKey, holdsAnthropicKey, readCassette, scrubCassette, sdkVersionOf, writeCassette } from "../src/gateway/cassette";

/**
 * TST-1 / TST-2: cassettes make real-Claude tests replayable. The key survives
 * what changes between runs (ids, timestamps) and not what matters; a recorded
 * file carries no secret; replay never touches the network.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "north-cassette-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The cassette key of a Messages request body (path and beta flags default to none). */
const keyOf = (body: unknown, path = "/v1/messages", betaHeader = "") => cassetteKey({ path, betaHeader, body });

const request = (overrides: Record<string, unknown> = {}) => ({
  model: "claude-haiku-5-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "Task id: 5a1c7a60-5d0c-4a52-8d3e-2f1f3a9b7c11\nDraft the post for 2026-10-16T08:30:00.000Z please." }],
  ...overrides,
});

describe("TST-2 cassetteKey", () => {
  it("is a sha256 hex digest", () => {
    expect(keyOf(request())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on key order, at any depth", () => {
    const a = { model: "m", messages: [{ role: "user", content: "x" }], metadata: { a: 1, b: { c: 2, d: 3 } } };
    const b = { metadata: { b: { d: 3, c: 2 }, a: 1 }, messages: [{ content: "x", role: "user" }], model: "m" };
    expect(keyOf(a)).toBe(keyOf(b));
  });

  it("is stable across uuid, timestamp and task-id changes", () => {
    const base = request();
    const changed = request({
      messages: [{ role: "user", content: "Task id: 9f8e7d6c-1111-4222-8333-444455556666\nDraft the post for 2027-01-02T03:04:05Z please." }],
    });
    expect(keyOf(changed)).toBe(keyOf(base));
    const upper = request({ messages: [{ role: "user", content: "Task id: 5A1C7A60-5D0C-4A52-8D3E-2F1F3A9B7C11\nDraft the post for 2026-10-16T08:30:00.000Z please." }] });
    expect(keyOf(upper)).toBe(keyOf(base));
  });

  it("normalises a UUID of any version or shape, not only v4", () => {
    const withId = (id: string) => ({ note: `run ${id} done` });
    expect(keyOf(withId("0190a4e0-7b3c-7d2e-9f1a-3c5b8e2d4f60"))).toBe(keyOf(withId("0190ffff-1111-7222-8333-444455556666")));
    expect(keyOf(withId("6ba7b810-9dad-11d1-80b4-00c04fd430c8"))).toBe(keyOf(withId("00000000-0000-0000-0000-000000000000")));
    expect(keyOf(withId("0190A4E0-7B3C-7D2E-9F1A-3C5B8E2D4F60"))).toBe(keyOf(withId("0190a4e0-7b3c-7d2e-9f1a-3c5b8e2d4f60")));
  });

  it("separates requests that differ only by path or by beta flags; the flags' order and spacing do not matter", () => {
    const body = request();
    const base = keyOf(body);
    expect(keyOf(body, "/v1/messages?beta=true")).not.toBe(base);
    expect(keyOf(body, "/v1/messages/count_tokens")).not.toBe(base);
    expect(keyOf(body, "/v1/messages", "prompt-caching-2024-07-31")).not.toBe(base);
    expect(keyOf(body, "/v1/messages", "a-1,b-2")).not.toBe(keyOf(body, "/v1/messages", "a-1"));
    expect(keyOf(body, "/v1/messages", "b-2, a-1")).toBe(keyOf(body, "/v1/messages", "a-1,b-2"));
    expect(keyOf(body, "/v1/messages", " a-1 ,, b-2 ")).toBe(keyOf(body, "/v1/messages", "a-1,b-2"));
    expect(keyOf(body, "/v1/messages", "")).toBe(base);
  });

  it("normalises a uuid, a timestamp and a task-id line anywhere in any string, nested", () => {
    const withIds = (id: string, at: string, task: string) => ({
      system: [{ type: "text", text: `Run ${id} started ${at}.\nTask id: ${task}\nBe brief.` }],
      tools: [{ name: "t", input_schema: { description: `Workspace ${id}` } }],
    });
    const one = withIds("0b6ed9f6-0000-4000-8000-000000000001", "2026-10-16T01:02:03+02:00", "task-1");
    const two = withIds("7c9d1e22-ffff-4fff-bfff-0000000000aa", "2030-02-03T23:59:59.123456Z", "totally-different-task-9");
    expect(keyOf(two)).toBe(keyOf(one));
  });

  it("finds an id or a timestamp next to an underscore or a dash, but not inside a longer hex run", () => {
    const meta = (id: string, at: string) => ({ metadata: { user_id: `user_abc_account_${id}_session_${id}`, note: `ts_${at}-end` } });
    expect(keyOf(meta("0b6ed9f6-0000-4000-8000-000000000001", "2026-10-16T01:02:03Z"))).toBe(keyOf(meta("7c9d1e22-ffff-4fff-bfff-0000000000aa", "2027-01-01T00:00:00Z")));
    const glued = (id: string) => keyOf({ text: `abc${id}` });
    expect(glued("0b6ed9f6-0000-4000-8000-000000000001")).not.toBe(glued("7c9d1e22-ffff-4fff-bfff-0000000000aa"));
  });

  it("changes when anything that matters changes", () => {
    const base = keyOf(request());
    expect(keyOf(request({ model: "claude-sonnet-5-5" }))).not.toBe(base);
    expect(keyOf(request({ max_tokens: 257 }))).not.toBe(base);
    expect(keyOf(request({ messages: [{ role: "user", content: "Task id: 5a1c7a60-5d0c-4a52-8d3e-2f1f3a9b7c11\nDraft the OTHER post." }] }))).not.toBe(base);
    expect(keyOf(request({ stream: true }))).not.toBe(base);
  });

  it("does not collapse a date without a time, or a number that looks like an id", () => {
    const day = (d: string) => keyOf({ content: `since ${d}` });
    expect(day("2026-10-01")).not.toBe(day("2026-10-02"));
    expect(keyOf({ n: 1 })).not.toBe(keyOf({ n: 2 }));
  });

  it("tells a string from a number and null from absent", () => {
    expect(keyOf({ a: "1" })).not.toBe(keyOf({ a: 1 }));
    expect(keyOf({ a: null })).not.toBe(keyOf({}));
    expect(keyOf([1, [2, null]])).toMatch(/^[0-9a-f]{64}$/);
    expect(keyOf("plain string")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not mutate its input", () => {
    const body = request();
    const before = JSON.stringify(body);
    keyOf(body);
    expect(JSON.stringify(body)).toBe(before);
  });
});

describe("TST-2 scrubCassette", () => {
  it("redacts Anthropic keys of any shape", () => {
    const out = scrubCassette("a sk-ant-api03-AbC_dEf-123 b sk-ant-oat01-xyz c");
    expect(out).toBe("a sk-ant-REDACTED b sk-ant-REDACTED c");
  });

  it("redacts bearer tokens, token-shaped ones only", () => {
    expect(scrubCassette("authorization: Bearer abc.DEF-123_456+/xyz= done")).toBe("authorization: Bearer REDACTED done");
    expect(scrubCassette('{"h":"Bearer eyJhbGciOi.payload.sig"}')).toBe('{"h":"Bearer REDACTED"}');
    expect(scrubCassette("Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Bearer REDACTED");
  });

  it("leaves plain English alone: 'the bearer of this note', 'Bearer bonds', a short word after the scheme", () => {
    const prose = "the bearer of this note may enter; Bearer bonds pay; the Bearer shortword; bearer of 15 chars";
    expect(scrubCassette(prose)).toBe(prose);
  });

  it("reads the scheme in any case, token-shaped only: 'bearer <16+ characters>' is a token too", () => {
    expect(scrubCassette("bearer abcdefghijklmnopqrstuvwxyz")).toBe("Bearer REDACTED");
    expect(scrubCassette('{"h":"BEARER eyJhbGciOi.payload.sig"}')).toBe('{"h":"Bearer REDACTED"}');
  });

  it("redacts emails under @north.test and only those", () => {
    expect(scrubCassette("mail bob.o+tag@north.test and ana@north.test; keep real@example.com")).toBe("mail redacted@north.test and redacted@north.test; keep real@example.com");
  });

  it("is idempotent and leaves clean text alone", () => {
    const dirty = "sk-ant-secret Bearer abcdefghijklmnop1234 bob@north.test";
    const once = scrubCassette(dirty);
    expect(scrubCassette(once)).toBe(once);
    expect(scrubCassette("nothing to see here")).toBe("nothing to see here");
  });
});

describe("TST-2 writeCassette and readCassette", () => {
  const key = keyOf(request());

  it("round-trips the response, byte for byte, through <key>.json", async () => {
    const body = Buffer.from('{"id":"msg_1","content":[{"type":"text","text":"héllo ✓"}]}', "utf8");
    await writeCassette(
      dir,
      key,
      { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" }, body },
      { method: "POST", path: "/v1/messages", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: Buffer.from(JSON.stringify(request())) },
    );
    expect(await readdir(dir)).toEqual([`${key}.json`]);
    const back = await readCassette(dir, key);
    expect(back).not.toBeNull();
    expect(back?.status).toBe(200);
    expect(back?.headers).toEqual({ "content-type": "application/json", "request-id": "req_1" });
    expect(back?.body.equals(body)).toBe(true);
  });

  it("stores bodies as base64 and removes the key headers from the request", async () => {
    await writeCassette(
      dir,
      key,
      { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") },
      {
        method: "POST",
        path: "/v1/messages",
        headers: { "x-api-key": "sk-ant-real-key", Authorization: "Bearer real-token", "anthropic-version": "2023-06-01" },
        body: Buffer.from('{"a":1}'),
      },
    );
    const raw = await readFile(join(dir, `${key}.json`), "utf8");
    const file = JSON.parse(raw) as { key: string; request: { method: string; path: string; headers: Record<string, string>; body: string }; response: { body: string } };
    expect(file.key).toBe(key);
    expect(file.request.method).toBe("POST");
    expect(file.request.path).toBe("/v1/messages");
    expect(Object.keys(file.request.headers).map((h) => h.toLowerCase())).toEqual(["anthropic-version"]);
    expect(Buffer.from(file.request.body, "base64").toString()).toBe('{"a":1}');
    expect(Buffer.from(file.response.body, "base64").toString()).toBe("{}");
    expect(raw).not.toContain("sk-ant-real-key");
    expect(raw).not.toContain("real-token");
  });

  it("scrubs the stored request (body, path and header values) but stores the response verbatim", async () => {
    const dirtyRequest = JSON.stringify(request({ metadata: { note: "key sk-ant-api03-LEAK and Bearer LEAKTOKENLEAKTOKEN1234, mail bob@north.test" } }));
    const reply = Buffer.from('{"text":"mail ana@north.test, the bearer of this note, Bearer SHORT"}');
    await writeCassette(
      dir,
      key,
      { status: 200, headers: { "content-type": "application/json", "x-note": "ana@north.test" }, body: reply },
      { method: "POST", path: "/v1/messages?note=sk-ant-api03-LEAKPATH", headers: { "x-trace": "sk-ant-api03-LEAK3" }, body: Buffer.from(dirtyRequest) },
    );
    const raw = await readFile(join(dir, `${key}.json`), "utf8");
    const file = JSON.parse(raw) as { request: { path: string; body: string; headers: Record<string, string> } };
    const storedRequest = [Buffer.from(file.request.body, "base64").toString(), file.request.path, JSON.stringify(file.request.headers)].join("\n");
    for (const leak of ["LEAK", "bob@north.test"]) expect(storedRequest).not.toContain(leak);
    expect(storedRequest).toContain("sk-ant-REDACTED");
    expect(storedRequest).toContain("redacted@north.test");
    expect(() => JSON.parse(Buffer.from(file.request.body, "base64").toString())).not.toThrow();
    const back = await readCassette(dir, key);
    expect(back?.body.equals(reply)).toBe(true);
    expect(back?.headers["x-note"]).toBe("ana@north.test");
  });

  it("refuses to record a response that holds an Anthropic key, and writes no file", async () => {
    const put = (body: string, headers: Record<string, string> = {}) =>
      writeCassette(dir, key, { status: 200, headers, body: Buffer.from(body) }, { method: "POST", path: "/v1/messages", headers: {}, body: Buffer.from("{}") });
    await expect(put('{"text":"my key is sk-ant-abc"}')).rejects.toThrow(/Anthropic key/);
    await expect(put("{}", { "x-echo": "sk-ant-api03-xyz" })).rejects.toThrow(/Anthropic key/);
    expect(await readdir(dir)).toEqual([]);
    expect(holdsAnthropicKey(Buffer.from('{"k":"sk-ant-abc"}'))).toBe(true);
    expect(holdsAnthropicKey(Buffer.from("sk-ant-"))).toBe(false);
    expect(holdsAnthropicKey(Buffer.from("nothing here"))).toBe(false);
  });

  it("drops set-cookie and the organisation id from the stored response headers", async () => {
    await writeCassette(
      dir,
      key,
      { status: 200, headers: { "content-type": "application/json", "set-cookie": "__cf_bm=abc", "anthropic-organization-id": "org-123", "request-id": "req_9" }, body: Buffer.from("{}") },
      { method: "POST", path: "/v1/messages", headers: {}, body: Buffer.from("{}") },
    );
    expect((await readCassette(dir, key))?.headers).toEqual({ "content-type": "application/json", "request-id": "req_9" });
  });

  it("creates the directory when it does not exist, and leaves no temp file behind", async () => {
    const nested = join(dir, "a", "b");
    await writeCassette(nested, key, { status: 200, headers: {}, body: Buffer.alloc(0) }, { method: "POST", path: "/v1/messages", headers: {}, body: Buffer.alloc(0) });
    expect(await readdir(nested)).toEqual([`${key}.json`]);
    expect((await readCassette(nested, key))?.body.length).toBe(0);
  });

  it("overwrites an earlier recording of the same key atomically", async () => {
    const put = (text: string) => writeCassette(dir, key, { status: 200, headers: {}, body: Buffer.from(text) }, { method: "POST", path: "/v1/messages", headers: {}, body: Buffer.from("{}") });
    await put("first");
    await put("second");
    expect((await readCassette(dir, key))?.body.toString()).toBe("second");
    expect(await readdir(dir)).toEqual([`${key}.json`]);
  });

  it("returns null when the cassette is missing (or its directory is)", async () => {
    expect(await readCassette(dir, key)).toBeNull();
    expect(await readCassette(join(dir, "nope"), key)).toBeNull();
  });

  it("throws on a malformed file instead of replaying garbage", async () => {
    await writeFile(join(dir, `${key}.json`), "{ not json");
    await expect(readCassette(dir, key)).rejects.toThrow(/malformed/i);
    await writeFile(join(dir, `${key}.json`), JSON.stringify({ key, request: {}, response: { status: 200 } }));
    await expect(readCassette(dir, key)).rejects.toThrow(/malformed/i);
    await writeFile(join(dir, `${key}.json`), JSON.stringify({ key: "0".repeat(64), request: { method: "POST", path: "/", headers: {}, body: "" }, response: { status: 200, headers: {}, body: "" } }));
    await expect(readCassette(dir, key)).rejects.toThrow(/malformed/i);
  });

  it("refuses a key that is not a sha256 hex digest, so a key can never name another path", async () => {
    await expect(readCassette(dir, "../../etc/passwd")).rejects.toThrow(/key/i);
    await expect(writeCassette(dir, "../x", { status: 200, headers: {}, body: Buffer.alloc(0) }, { method: "POST", path: "/", headers: {}, body: Buffer.alloc(0) })).rejects.toThrow(/key/i);
  });
});

describe("TST-2 sdkVersionOf", () => {
  it("reads the Agent SDK version from the user agent the Claude Code subprocess sends", () => {
    expect(sdkVersionOf("claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.3.301)")).toBe("0.3.301");
    expect(sdkVersionOf("claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.3.301, client-app/north/1.0, workload/cron)")).toBe("0.3.301");
    expect(sdkVersionOf("claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.4.0-beta.2)")).toBe("0.4.0-beta.2");
    // Captured from the real @anthropic-ai/claude-agent-sdk 0.3.301 subprocess on `POST /v1/messages?beta=true` (the entrypoint field is the session's CLAUDE_CODE_ENTRYPOINT).
    expect(sdkVersionOf("claude-cli/2.1.301 (external, remote_desktop, agent-sdk/0.3.301)")).toBe("0.3.301");
  });

  it("is null when the user agent names no Agent SDK: the CLI alone, the API client, nothing", () => {
    expect(sdkVersionOf("claude-cli/2.1.301 (external, cli)")).toBeNull();
    expect(sdkVersionOf("Anthropic/JS 0.134.0")).toBeNull();
    expect(sdkVersionOf("")).toBeNull();
    expect(sdkVersionOf(undefined)).toBeNull();
  });

  it("does not take a version out of another field (the CLI's own version, a client-app that contains the words)", () => {
    expect(sdkVersionOf("claude-cli/2.1.301 (external, sdk-ts, client-app/agent-sdk/9.9.9)")).toBeNull();
    expect(sdkVersionOf("claude-cli/2.1.301 (external, sdk-ts, agent-sdk/latest)")).toBeNull();
  });
});

describe("TST-2 the meta block of a recording", () => {
  const key = keyOf(request());
  const at = () => new Date("2026-10-17T09:00:00.000Z");
  const reply = { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") };
  const sdkAgent = "claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.3.301)";
  const put = (req: { path?: string; headers?: Record<string, string>; body?: string }) =>
    writeCassette(dir, key, reply, { method: "POST", path: req.path ?? "/v1/messages?beta=true", headers: req.headers ?? { "user-agent": sdkAgent }, body: Buffer.from(req.body ?? JSON.stringify(request())) }, at);
  const metaOnDisk = async () => (JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")) as { meta?: Record<string, unknown> }).meta;

  it("records the SDK version from the user agent, the time from the clock, that nothing was scrubbed, and the gateway mode", async () => {
    await put({});
    expect(await metaOnDisk()).toEqual({ sdkVersion: "0.3.301", recordedAt: "2026-10-17T09:00:00.000Z", requestScrubbed: false, gatewayMode: "record" });
  });

  it("keeps sdkVersion null when the user agent names no Agent SDK or there is none", async () => {
    await put({ headers: { "user-agent": "Anthropic/JS 0.134.0" } });
    expect((await metaOnDisk())?.sdkVersion).toBeNull();
    await put({ headers: {} });
    expect((await metaOnDisk())?.sdkVersion).toBeNull();
  });

  it("flags requestScrubbed when scrubbing changed the body, the path or the beta header (the parts a key is made of), and only then", async () => {
    await put({ body: JSON.stringify(request({ metadata: { note: "mail bob@north.test" } })) });
    expect((await metaOnDisk())?.requestScrubbed).toBe(true);
    await put({ path: "/v1/messages?note=sk-ant-api03-LEAKPATH" });
    expect((await metaOnDisk())?.requestScrubbed).toBe(true);
    await put({ headers: { "anthropic-beta": "Bearer LEAKTOKENLEAKTOKEN1234", "user-agent": sdkAgent } });
    expect((await metaOnDisk())?.requestScrubbed).toBe(true);
    await put({ headers: { "x-trace": "sk-ant-api03-LEAK3", "user-agent": sdkAgent } });
    expect((await metaOnDisk())?.requestScrubbed).toBe(false);
  });

  it("stamps the wall clock when none is given", async () => {
    const before = Date.now();
    await writeCassette(dir, key, reply, { method: "POST", path: "/v1/messages", headers: {}, body: Buffer.from("{}") });
    const recordedAt = Date.parse(String((await metaOnDisk())?.recordedAt));
    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(recordedAt).toBeLessThanOrEqual(Date.now());
  });

  it("still reads a cassette recorded before meta existed, and the schema makes meta optional but checks it when present", async () => {
    const old = { key, request: { method: "POST", path: "/v1/messages", headers: {}, body: "" }, response: { status: 200, headers: {}, body: Buffer.from("old").toString("base64") } };
    await writeFile(join(dir, `${key}.json`), JSON.stringify(old));
    expect((await readCassette(dir, key))?.body.toString()).toBe("old");
    expect(CassetteFileSchema.safeParse(old).success).toBe(true);
    const meta = { sdkVersion: null, recordedAt: "2026-10-17T09:00:00.000Z", requestScrubbed: true, gatewayMode: "record" };
    expect(CassetteFileSchema.safeParse({ ...old, meta }).success).toBe(true);
    expect(CassetteFileSchema.safeParse({ ...old, meta: { ...meta, recordedAt: "yesterday" } }).success).toBe(false);
    expect(CassetteFileSchema.safeParse({ ...old, meta: { ...meta, gatewayMode: "replay" } }).success).toBe(false);
    expect(CassetteFileSchema.safeParse({ ...old, meta: { sdkVersion: null } }).success).toBe(false);
  });
});
