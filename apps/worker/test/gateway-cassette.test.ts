import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayBudget } from "../src/gateway/budget";
import { cassetteKey, readCassette, scrubCassette, writeCassette } from "../src/gateway/cassette";
import { startGateway, type Gateway } from "../src/gateway/server";
import { call, completion as completionBody, fakeUpstream, jsonHandler, type FakeUpstream } from "./gateway-helpers";

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

const request = (overrides: Record<string, unknown> = {}) => ({
  model: "claude-haiku-5-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "Task id: 5a1c7a60-5d0c-4a52-8d3e-2f1f3a9b7c11\nDraft the post for 2026-10-16T08:30:00.000Z please." }],
  ...overrides,
});

describe("TST-2 cassetteKey", () => {
  it("is a sha256 hex digest", () => {
    expect(cassetteKey(request())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on key order, at any depth", () => {
    const a = { model: "m", messages: [{ role: "user", content: "x" }], metadata: { a: 1, b: { c: 2, d: 3 } } };
    const b = { metadata: { b: { d: 3, c: 2 }, a: 1 }, messages: [{ content: "x", role: "user" }], model: "m" };
    expect(cassetteKey(a)).toBe(cassetteKey(b));
  });

  it("is stable across uuid, timestamp and task-id changes", () => {
    const base = request();
    const changed = request({
      messages: [{ role: "user", content: "Task id: 9f8e7d6c-1111-4222-8333-444455556666\nDraft the post for 2027-01-02T03:04:05Z please." }],
    });
    expect(cassetteKey(changed)).toBe(cassetteKey(base));
    const upper = request({ messages: [{ role: "user", content: "Task id: 5A1C7A60-5D0C-4A52-8D3E-2F1F3A9B7C11\nDraft the post for 2026-10-16T08:30:00.000Z please." }] });
    expect(cassetteKey(upper)).toBe(cassetteKey(base));
  });

  it("normalises a uuid, a timestamp and a task-id line anywhere in any string, nested", () => {
    const withIds = (id: string, at: string, task: string) => ({
      system: [{ type: "text", text: `Run ${id} started ${at}.\nTask id: ${task}\nBe brief.` }],
      tools: [{ name: "t", input_schema: { description: `Workspace ${id}` } }],
    });
    const one = withIds("0b6ed9f6-0000-4000-8000-000000000001", "2026-10-16T01:02:03+02:00", "task-1");
    const two = withIds("7c9d1e22-ffff-4fff-bfff-0000000000aa", "2030-02-03T23:59:59.123456Z", "totally-different-task-9");
    expect(cassetteKey(two)).toBe(cassetteKey(one));
  });

  it("finds an id or a timestamp next to an underscore or a dash, but not inside a longer hex run", () => {
    const meta = (id: string, at: string) => ({ metadata: { user_id: `user_abc_account_${id}_session_${id}`, note: `ts_${at}-end` } });
    expect(cassetteKey(meta("0b6ed9f6-0000-4000-8000-000000000001", "2026-10-16T01:02:03Z"))).toBe(cassetteKey(meta("7c9d1e22-ffff-4fff-bfff-0000000000aa", "2027-01-01T00:00:00Z")));
    const glued = (id: string) => cassetteKey({ text: `abc${id}` });
    expect(glued("0b6ed9f6-0000-4000-8000-000000000001")).not.toBe(glued("7c9d1e22-ffff-4fff-bfff-0000000000aa"));
  });

  it("changes when anything that matters changes", () => {
    const base = cassetteKey(request());
    expect(cassetteKey(request({ model: "claude-sonnet-5-5" }))).not.toBe(base);
    expect(cassetteKey(request({ max_tokens: 257 }))).not.toBe(base);
    expect(cassetteKey(request({ messages: [{ role: "user", content: "Task id: 5a1c7a60-5d0c-4a52-8d3e-2f1f3a9b7c11\nDraft the OTHER post." }] }))).not.toBe(base);
    expect(cassetteKey(request({ stream: true }))).not.toBe(base);
  });

  it("does not collapse a date without a time, or a number that looks like an id", () => {
    const day = (d: string) => cassetteKey({ content: `since ${d}` });
    expect(day("2026-10-01")).not.toBe(day("2026-10-02"));
    expect(cassetteKey({ n: 1 })).not.toBe(cassetteKey({ n: 2 }));
  });

  it("tells a string from a number and null from absent", () => {
    expect(cassetteKey({ a: "1" })).not.toBe(cassetteKey({ a: 1 }));
    expect(cassetteKey({ a: null })).not.toBe(cassetteKey({}));
    expect(cassetteKey([1, [2, null]])).toMatch(/^[0-9a-f]{64}$/);
    expect(cassetteKey("plain string")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not mutate its input", () => {
    const body = request();
    const before = JSON.stringify(body);
    cassetteKey(body);
    expect(JSON.stringify(body)).toBe(before);
  });
});

describe("TST-2 scrubCassette", () => {
  it("redacts Anthropic keys of any shape", () => {
    const out = scrubCassette("a sk-ant-api03-AbC_dEf-123 b sk-ant-oat01-xyz c");
    expect(out).toBe("a sk-ant-REDACTED b sk-ant-REDACTED c");
  });

  it("redacts bearer tokens", () => {
    expect(scrubCassette("authorization: Bearer abc.DEF-123_456+/= done")).toBe("authorization: Bearer REDACTED done");
    expect(scrubCassette('{"h":"Bearer eyJhbGciOi.payload.sig"}')).toBe('{"h":"Bearer REDACTED"}');
  });

  it("redacts emails under @north.test and only those", () => {
    expect(scrubCassette("mail bob.o+tag@north.test and ana@north.test; keep real@example.com")).toBe("mail redacted@north.test and redacted@north.test; keep real@example.com");
  });

  it("is idempotent and leaves clean text alone", () => {
    const dirty = "sk-ant-secret Bearer tok bob@north.test";
    const once = scrubCassette(dirty);
    expect(scrubCassette(once)).toBe(once);
    expect(scrubCassette("nothing to see here")).toBe("nothing to see here");
  });
});

describe("TST-2 writeCassette and readCassette", () => {
  const key = cassetteKey(request());

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

  it("scrubs secrets out of the stored request, the response and the header values", async () => {
    const dirtyRequest = JSON.stringify(request({ metadata: { note: "key sk-ant-api03-LEAK and Bearer LEAKTOKEN, mail bob@north.test" } }));
    await writeCassette(
      dir,
      key,
      { status: 200, headers: { "content-type": "application/json", "x-note": "Bearer LEAKHEADER" }, body: Buffer.from('{"text":"echo sk-ant-api03-LEAK2 ana@north.test"}') },
      { method: "POST", path: "/v1/messages", headers: { "x-trace": "sk-ant-api03-LEAK3" }, body: Buffer.from(dirtyRequest) },
    );
    const raw = await readFile(join(dir, `${key}.json`), "utf8");
    const file = JSON.parse(raw) as { request: { body: string; headers: Record<string, string> }; response: { body: string; headers: Record<string, string> } };
    const stored = [
      Buffer.from(file.request.body, "base64").toString(),
      Buffer.from(file.response.body, "base64").toString(),
      JSON.stringify(file.request.headers),
      JSON.stringify(file.response.headers),
    ].join("\n");
    for (const leak of ["LEAK", "bob@north.test", "ana@north.test"]) expect(stored).not.toContain(leak);
    expect(stored).toContain("sk-ant-REDACTED");
    expect(stored).toContain("redacted@north.test");
    expect(() => JSON.parse(Buffer.from(file.request.body, "base64").toString())).not.toThrow();
    expect(() => JSON.parse(Buffer.from(file.response.body, "base64").toString())).not.toThrow();
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

// ---- record and replay through the gateway ---------------------------------

const completion = completionBody();

describe("TST-2 record then replay", () => {
  let upstream: FakeUpstream;
  let gateways: Gateway[] = [];
  const logs: string[] = [];

  beforeEach(async () => {
    upstream = await fakeUpstream();
    upstream.handler = jsonHandler(completion);
    gateways = [];
    logs.length = 0;
  });
  afterEach(async () => {
    await Promise.all(gateways.map((g) => g.close()));
    await upstream.close();
    expect(logs).toEqual([]);
  });

  const start = async (mode: "live" | "record" | "replay", apiKey: string | null = "sk-ant-real", budget = new GatewayBudget(0)): Promise<Gateway> => {
    const gateway = await startGateway({ apiKey, upstream: upstream.url, mode, cassetteDir: dir, budget, log: (m) => logs.push(m) });
    gateways.push(gateway);
    return gateway;
  };
  const post = (gateway: Gateway, body: unknown) => call(gateway.baseUrl, { body: body as Record<string, unknown> });

  it("TST-2 record then replay serves the stored body without touching the upstream", async () => {
    const recorder = await start("record");
    const live = await post(recorder, request());
    expect(live.status).toBe(200);
    expect(upstream.seen).toHaveLength(1);
    await recorder.close();

    const files = await readdir(dir);
    expect(files).toEqual([`${cassetteKey(request())}.json`]);

    const replayer = await start("replay", null);
    // A later run: other task id, other timestamp, same request.
    const again = await post(
      replayer,
      request({ messages: [{ role: "user", content: "Task id: 11111111-2222-4333-8444-555555555555\nDraft the post for 2031-05-06T07:08:09Z please." }] }),
    );
    expect(again.status).toBe(200);
    expect(again.headers["content-type"]).toBe("application/json");
    expect(again.headers["content-length"]).toBe(String(Buffer.byteLength(completion)));
    expect(again.body.toString()).toBe(completion);
    expect(upstream.seen).toHaveLength(1);
    expect(replayer.stats()).toMatchObject({ requests: 1, misses: 0 });
  });

  it("prices a replayed response from the stored body", async () => {
    const recorder = await start("record");
    await post(recorder, request());
    const recorded = recorder.stats().spentUsd;
    expect(recorded).toBeCloseTo((1000 * 0.1 + 200 * 0.5) / 1_000_000, 12);
    await recorder.close();

    const replayBudget = new GatewayBudget(0);
    const replayer = await start("replay", null, replayBudget);
    await post(replayer, request());
    expect(replayer.stats().spentUsd).toBeCloseTo(recorded, 12);
    expect(replayBudget.stats().spentUsd).toBeCloseTo(recorded, 12);
  });

  it("replay miss answers 502 with the key and counts the miss", async () => {
    const replayer = await start("replay", null);
    const body = request({ messages: [{ role: "user", content: "never recorded" }] });
    const res = await post(replayer, body);
    expect(res.status).toBe(502);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_cassette_miss", key: cassetteKey(body) } });
    expect(replayer.stats().misses).toBe(1);
    expect(upstream.seen).toHaveLength(0);
  });

  it("replay answers a malformed cassette with 502 and its key, not a hang or a crash", async () => {
    const key = cassetteKey(request());
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.json`), "garbage");
    const replayer = await start("replay", null);
    const res = await post(replayer, request());
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_cassette_invalid", key } });
    expect(upstream.seen).toHaveLength(0);
    expect(logs).toEqual([expect.stringContaining(`cassette ${key}.json is malformed`)]);
    logs.length = 0;
  });

  it("record stores a non-2xx exchange too, and replay serves its status", async () => {
    const errorBody = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
    upstream.handler = jsonHandler(errorBody, 429);
    const recorder = await start("record");
    expect((await post(recorder, request())).status).toBe(429);
    await recorder.close();

    const replayer = await start("replay", null);
    const again = await post(replayer, request());
    expect(again.status).toBe(429);
    expect(again.body.toString()).toBe(errorBody);
    expect(replayer.stats().unpriced).toBe(0);
  });

  it("the recorded file holds no key, and live mode records nothing", async () => {
    const live = await start("live");
    await post(live, request());
    expect(await readdir(dir)).toEqual([]);
    await live.close();

    const recorder = await start("record", "sk-ant-api03-THE-REAL-KEY");
    await post(recorder, request());
    const [file] = await readdir(dir);
    const raw = await readFile(join(dir, file!), "utf8");
    expect(raw).not.toContain("THE-REAL-KEY");
    expect(raw).not.toContain("north-gateway");
  });

  it("only the modes that contact the upstream need a key", async () => {
    const budget = new GatewayBudget(0);
    for (const mode of ["live", "record"] as const) {
      await expect(startGateway({ apiKey: null, upstream: upstream.url, mode, cassetteDir: dir, budget })).rejects.toThrow(/API key/i);
      await expect(startGateway({ apiKey: "", upstream: upstream.url, mode, cassetteDir: dir, budget })).rejects.toThrow(/API key/i);
    }
    const replayer = await start("replay", null);
    expect(replayer.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
