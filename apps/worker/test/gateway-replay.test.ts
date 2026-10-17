import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayBudget } from "../src/gateway/budget";
import { cassetteKey } from "../src/gateway/cassette";
import { startGateway, type Gateway } from "../src/gateway/server";
import { call, completion as completionBody, jsonHandler, USAGE, useGateway } from "./gateway-helpers";

/**
 * TST-2: record then replay through the gateway. Replay never touches the
 * upstream, serves what was recorded verbatim, and a miss names its key.
 */

const keyOf = (body: unknown, path = "/v1/messages", betaHeader = "") => cassetteKey({ path, betaHeader, body });

const request = (overrides: Record<string, unknown> = {}) => ({
  model: "claude-haiku-5-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "Task id: 5a1c7a60-5d0c-4a52-8d3e-2f1f3a9b7c11\nDraft the post for 2026-10-16T08:30:00.000Z please." }],
  ...overrides,
});

const completion = completionBody();
const h = useGateway();

afterEach(() => {
  expect(h.logs, "unexpected gateway log").toEqual([]);
});

describe("TST-2 record then replay", () => {
  const start = (mode: "live" | "record" | "replay", apiKey: string | null = "sk-ant-real", budget = new GatewayBudget(0)): Promise<Gateway> => h.start({ mode, apiKey, budget });
  const post = (gateway: Gateway, body: unknown) => call(gateway.baseUrl, { body: body as Record<string, unknown> });

  it("TST-2 record then replay serves the stored body without touching the upstream", async () => {
    const recorder = await start("record");
    const live = await post(recorder, request());
    expect(live.status).toBe(200);
    expect(h.upstream.seen).toHaveLength(1);
    await recorder.close();

    const files = await readdir(h.dir);
    expect(files).toEqual([`${keyOf(request())}.json`]);

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
    expect(h.upstream.seen).toHaveLength(1);
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
    expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_cassette_miss", key: keyOf(body) } });
    expect(replayer.stats().misses).toBe(1);
    expect(h.upstream.seen).toHaveLength(0);
  });

  it("replay answers a malformed cassette with 502 and its key, not a hang or a crash", async () => {
    const key = keyOf(request());
    await mkdir(h.dir, { recursive: true });
    await writeFile(join(h.dir, `${key}.json`), "garbage");
    const replayer = await start("replay", null);
    const res = await post(replayer, request());
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_cassette_invalid", key } });
    expect(h.upstream.seen).toHaveLength(0);
    expect(h.logs).toEqual([expect.stringContaining(`cassette ${key}.json is malformed`)]);
    h.logs.length = 0;
  });

  it("TST-2 replays a two-turn run whose first reply holds an @north.test address that the second request echoes", async () => {
    const turnOne = { model: "claude-haiku-5-5", max_tokens: 64, messages: [{ role: "user", content: "who should we write to?" }] };
    const reply = completionBody("claude-haiku-5-5", USAGE, "Write to x@north.test about the Bearer of this note.");
    const turnTwo = {
      ...turnOne,
      messages: [...turnOne.messages, { role: "assistant", content: "Write to x@north.test about the Bearer of this note." }, { role: "user", content: "draft it" }],
    };
    const turnTwoReply = completionBody("claude-haiku-5-5", USAGE, "Dear x@north.test, hello.");
    h.upstream.handler = (req, res) => jsonHandler(req.body.toString().includes("draft it") ? turnTwoReply : reply)(req, res);
    const recorder = await start("record");
    expect((await post(recorder, turnOne)).body.toString()).toBe(reply);
    expect((await post(recorder, turnTwo)).body.toString()).toBe(turnTwoReply);
    await recorder.close();
    expect(await readdir(h.dir)).toHaveLength(2);

    const seen = h.upstream.seen.length;
    const replayer = await start("replay", null);
    const one = await post(replayer, turnOne);
    const two = await post(replayer, turnTwo);
    expect(one.body.toString()).toBe(reply); // verbatim: the address is not redacted on the way back
    expect(one.body.toString()).toContain("x@north.test");
    expect(two.body.toString()).toBe(turnTwoReply);
    expect(h.upstream.seen).toHaveLength(seen);
    expect(replayer.stats()).toMatchObject({ requests: 2, misses: 0 });
    // The stored request is scrubbed, the stored response is not.
    const stored = await Promise.all((await readdir(h.dir)).map(async (f) => JSON.parse(await readFile(join(h.dir, f), "utf8")) as { request: { body: string } }));
    for (const file of stored) expect(Buffer.from(file.request.body, "base64").toString()).not.toContain("x@north.test");
  });

  it("does not record a response that holds an Anthropic key: it is served, logged once, and written nowhere", async () => {
    const leaky = completionBody("claude-haiku-5-5", USAGE, "the key is sk-ant-abc");
    h.upstream.handler = jsonHandler(leaky);
    const recorder = await start("record");
    const res = await post(recorder, request());
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe(leaky);
    expect(await readdir(h.dir)).toEqual([]);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatch(/Anthropic key/);
    expect(h.logs[0]).not.toContain("sk-ant-abc");
    h.logs.length = 0;
    expect(recorder.stats().spentUsd).toBeGreaterThan(0);
  });

  it("stores only the allowlisted request headers, and a different beta flag is a different cassette", async () => {
    const recorder = await start("record");
    const headers = { cookie: "s=1", "x-forwarded-host": "evil.example", "anthropic-beta": "b-2, a-1", "user-agent": "cli/1", authorization: "Bearer abcdefghijklmnopqrstuvwx" };
    await call(recorder.baseUrl, { headers, body: request() });
    await recorder.close();
    expect(h.upstream.seen[0]!.headers.cookie).toBeUndefined();
    const [file] = await readdir(h.dir);
    const stored = JSON.parse(await readFile(join(h.dir, file!), "utf8")) as { request: { headers: Record<string, string> } };
    expect(Object.keys(stored.request.headers).sort()).toEqual(["anthropic-beta", "anthropic-version", "content-type", "user-agent"]);
    expect(JSON.stringify(stored)).not.toMatch(/cookie|evil\.example|abcdefghijklmnopqrstuvwx/);

    const replayer = await start("replay", null);
    const same = await call(replayer.baseUrl, { headers: { "anthropic-beta": "a-1,b-2" }, body: request() });
    expect(same.status).toBe(200);
    for (const beta of [null, "a-1", "a-1,b-2,c-3"]) {
      const miss = await call(replayer.baseUrl, { headers: { "anthropic-beta": beta }, body: request() });
      expect(miss.status, String(beta)).toBe(502);
    }
    expect((await call(replayer.baseUrl, { path: "/v1/messages?beta=true", headers: { "anthropic-beta": "a-1,b-2" }, body: request() })).status).toBe(502);
    expect(replayer.stats().misses).toBe(4);
  });

  it("a recording through the gateway carries meta: the SDK version from the user agent, a time, no scrubbing for a clean request", async () => {
    const recorder = await start("record");
    await call(recorder.baseUrl, { headers: { "user-agent": "claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.3.301)" }, body: request() });
    await recorder.close();
    const [file] = await readdir(h.dir);
    const stored = JSON.parse(await readFile(join(h.dir, file!), "utf8")) as { meta: { recordedAt: string } };
    expect(stored.meta).toMatchObject({ sdkVersion: "0.3.301", requestScrubbed: false, gatewayMode: "record" });
    expect(Number.isNaN(Date.parse(stored.meta.recordedAt))).toBe(false);
  });

  it("record stores a non-2xx exchange too, and replay serves its status", async () => {
    const errorBody = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
    h.upstream.handler = jsonHandler(errorBody, 429);
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
    expect(await readdir(h.dir)).toEqual([]);
    await live.close();

    const recorder = await start("record", "sk-ant-api03-THE-REAL-KEY");
    await post(recorder, request());
    const [file] = await readdir(h.dir);
    const raw = await readFile(join(h.dir, file!), "utf8");
    expect(raw).not.toContain("THE-REAL-KEY");
    expect(raw).not.toContain("north-gateway");
  });

  it("only the modes that contact the upstream need a key", async () => {
    const budget = new GatewayBudget(0);
    for (const mode of ["live", "record"] as const) {
      await expect(startGateway({ apiKey: null, upstream: h.upstream.url, mode, cassetteDir: h.dir, budget })).rejects.toThrow(/API key/i);
      await expect(startGateway({ apiKey: "", upstream: h.upstream.url, mode, cassetteDir: h.dir, budget })).rejects.toThrow(/API key/i);
    }
    const replayer = await start("replay", null);
    expect(replayer.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
