import { readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { costOfUsage } from "@north/core";
import { GatewayBudget } from "../src/gateway/budget";
import { DEFAULT_MAX_CAPTURE_BYTES, DEFAULT_MAX_REQUEST_BYTES } from "../src/gateway/server";
import { call, closedPort, completion, errorType, jsonHandler, MESSAGES, open, readUntil, sseEvent, useGateway } from "./gateway-helpers";

/**
 * SEC-1 / TST-2: what the gateway does when things go wrong (down upstream,
 * oversized or compressed bodies, hang-ups, bad options) and how a streamed
 * exchange goes through record and replay.
 */

const h = useGateway();

describe("SEC-1 gateway failure modes", () => {
  it("answers 502 when the upstream is down, and keeps serving", async () => {
    const port = await closedPort();
    const gateway = await h.start({ upstream: `http://127.0.0.1:${port}` });
    const res = await call(gateway.baseUrl, { body: MESSAGES });
    expect(res.status).toBe(502);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_upstream_unreachable" } });
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(502);
    expect(gateway.stats()).toMatchObject({ spentUsd: 0, unpriced: 0 });
    expect(h.logs).toEqual(["gateway: upstream unreachable (ECONNREFUSED)", "gateway: upstream unreachable (ECONNREFUSED)"]);
    h.logs.length = 0;
  });

  it("answers 400 for a body that is not a JSON object, without contacting the upstream", async () => {
    const gateway = await h.start();
    for (const body of ["", "not json", "[1,2]", '"text"', "null"]) {
      const res = await call(gateway.baseUrl, { body });
      expect(res.status, body).toBe(400);
      expect(errorType(res.body)).toBe("north_gateway_bad_request");
    }
    expect(h.upstream.seen).toHaveLength(0);
    expect(gateway.stats().requests).toBe(0);
  });

  it("answers 413 beyond the body limit and stays up; the limit is 32 MB by default", async () => {
    const gateway = await h.start({ maxRequestBytes: 1024 });
    const big = await call(gateway.baseUrl, { body: JSON.stringify({ ...MESSAGES, pad: "x".repeat(2000) }) });
    expect(big.status).toBe(413);
    expect(big.headers["content-type"]).toBe("application/json");
    expect(errorType(big.body)).toBe("north_gateway_too_large");
    expect(h.upstream.seen).toHaveLength(0);
    expect(gateway.stats().requests).toBe(0);
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(DEFAULT_MAX_REQUEST_BYTES).toBe(32 * 1024 * 1024);
    expect(DEFAULT_MAX_CAPTURE_BYTES).toBe(8 * 1024 * 1024);
  });

  it("hangs up on a body far beyond the limit instead of draining it, and keeps serving", async () => {
    const gateway = await h.start({ maxRequestBytes: 1024 });
    const outcome = await call(gateway.baseUrl, { body: "z".repeat(64 * 1024) }).then(
      (reply) => reply.status,
      () => "reset",
    );
    expect([413, "reset"]).toContain(outcome);
    expect(h.upstream.seen).toHaveLength(0);
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
  });

  it("passes a response beyond the capture limit through intact, but leaves it unpriced and unrecorded", async () => {
    const big = JSON.stringify({ ...JSON.parse(completion()), pad: "y".repeat(5000) });
    h.upstream.handler = jsonHandler(big);
    const gateway = await h.start({ mode: "record", maxCaptureBytes: 1024 });
    const res = await call(gateway.baseUrl, { body: MESSAGES });
    expect(res.body.toString()).toBe(big);
    expect(gateway.stats()).toMatchObject({ requests: 1, spentUsd: 0, unpriced: 1 });
    expect(await readdir(h.dir)).toEqual([]);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatch(/too large/i);
    h.logs.length = 0;
  });

  it("a compressed reply cannot be priced or scrubbed: it passes through, unpriced and unrecorded", async () => {
    const zipped = gzipSync(Buffer.from(completion()));
    h.upstream.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.end(zipped);
    };
    const gateway = await h.start({ mode: "record" });
    const res = await call(gateway.baseUrl, { body: MESSAGES });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.body.equals(zipped)).toBe(true);
    expect(gateway.stats()).toMatchObject({ spentUsd: 0, unpriced: 1 });
    expect(await readdir(h.dir)).toEqual([]);
    expect(h.logs).toHaveLength(1);
    h.logs.length = 0;
  });

  it("hangs up on the upstream when the caller hangs up mid-stream, and still prices what was streamed", async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    h.upstream.handler = (_req, res) => {
      res.on("close", upstreamClosed);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseEvent("message_start", { message: { model: "claude-haiku-5-5", usage: { input_tokens: 1000, output_tokens: 1 } } }));
    };
    const gateway = await h.start({ mode: "record" });
    const call1 = open(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    const res = await call1.response;
    await readUntil(res, "message_start");
    res.destroy();
    await closed;
    await vi.waitFor(() => expect(gateway.stats().spentUsd).toBeGreaterThan(0));
    expect(gateway.stats().spentUsd).toBeCloseTo((1000 * 0.1 + 1 * 0.5) / 1_000_000, 12);
    expect(await readdir(h.dir)).toEqual([]); // an aborted exchange is not a recording
  });

  it("close() resolves and cuts an exchange that is still running", async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    h.upstream.handler = (_req, res) => {
      res.on("close", upstreamClosed);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseEvent("message_start", { message: { model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1 } } }));
    };
    const gateway = await h.start();
    const { response } = open(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    const res = await response;
    res.on("error", () => undefined);
    await readUntil(res, "message_start");
    await gateway.close();
    await closed;
    await expect(call(gateway.baseUrl, { body: MESSAGES })).rejects.toThrow();
  });
});

describe("SEC-1 gateway start-up", () => {
  it("binds 127.0.0.1 on an ephemeral port, or on the port it is given", async () => {
    const first = await h.start();
    expect(first.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const port = await closedPort();
    const second = await h.start({ port });
    expect(second.baseUrl).toBe(`http://127.0.0.1:${port}`);
  });

  it("refuses an upstream that is not https unless it is loopback, and one that is not a URL", async () => {
    await expect(h.start({ upstream: "http://api.anthropic.com" })).rejects.toThrow(/upstream/i);
    await expect(h.start({ upstream: "ftp://api.anthropic.com" })).rejects.toThrow(/upstream/i);
    await expect(h.start({ upstream: "api.anthropic.com" })).rejects.toThrow(/upstream/i);
    await expect(h.start({ upstream: "https://user:pass@api.anthropic.com" })).rejects.toThrow(/upstream/i);
    await expect(h.start({ upstream: "https://api.anthropic.com/?x=1" })).rejects.toThrow(/upstream/i);
    expect(await h.start({ upstream: "https://api.anthropic.com" })).toBeDefined();
    expect(await h.start({ upstream: "http://localhost:9" })).toBeDefined();
    expect(await h.start({ upstream: "http://[::1]:9" })).toBeDefined();
  });

  it("refuses options it cannot trust, with a readable error that never prints the key", async () => {
    await expect(h.start({ apiKey: null })).rejects.toThrow(/API key/i);
    await expect(h.start({ apiKey: "bad key\r\nx-evil: 1" })).rejects.toThrow(/API key/i);
    await expect(h.start({ apiKey: "bad key\r\nx-evil: 1" })).rejects.not.toThrow(/x-evil/);
    await expect(h.start({ mode: "tape" as never })).rejects.toThrow(/mode/i);
    await expect(h.start({ cassetteDir: "" })).rejects.toThrow(/cassette/i);
    await expect(h.start({ port: 70000 })).rejects.toThrow(/port/i);
    await expect(h.start({ host: "0.0.0.0" as never })).rejects.toThrow(/host/i);
  });

  it("keeps a base path on the upstream", async () => {
    const gateway = await h.start({ upstream: `${h.upstream.url}/proxy/` });
    await call(gateway.baseUrl, { path: "/v1/messages?beta=true", body: MESSAGES });
    expect(h.upstream.seen[0]!.url).toBe("/proxy/v1/messages?beta=true");
  });
});

describe("TST-2 streaming through record and replay", () => {
  it("TST-2 a streamed exchange is recorded whole and replayed with the same content-type and bytes", async () => {
    const wire = Buffer.from(
      sseEvent("message_start", { message: { model: "claude-haiku-5-5", usage: { input_tokens: 50, output_tokens: 1 } } }) +
        sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "ok" } }) +
        sseEvent("message_delta", { delta: {}, usage: { output_tokens: 7 } }) +
        sseEvent("message_stop", {}),
    );
    h.upstream.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.end(wire);
    };
    const recorder = await h.start({ mode: "record" });
    const live = await call(recorder.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(live.body.equals(wire)).toBe(true);
    await recorder.close();

    const seen = h.upstream.seen.length;
    const replayer = await h.start({ mode: "replay", apiKey: null });
    const again = await call(replayer.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(again.status).toBe(200);
    expect(again.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(again.body.equals(wire)).toBe(true);
    expect(h.upstream.seen).toHaveLength(seen);
    expect(replayer.stats().spentUsd).toBeCloseTo((50 * 0.1 + 7 * 0.5) / 1_000_000, 12);
    expect(costOfUsage({ model: "claude-haiku-5-5", inputTokens: 50, outputTokens: 7, cacheReadTokens: 0 })).toBeCloseTo(replayer.stats().spentUsd, 12);
  });

  it("replay never contacts the upstream, not even for count_tokens, which it cannot replay", async () => {
    const replayer = await h.start({ mode: "replay", apiKey: null });
    const res = await call(replayer.baseUrl, { path: "/v1/messages/count_tokens", body: MESSAGES });
    expect(res.status).toBe(501);
    expect(errorType(res.body)).toBe("north_replay_unsupported");
    expect(h.upstream.seen).toHaveLength(0);
  });

  it("the day cap holds in replay too: replayed calls are priced like live ones", async () => {
    h.upstream.handler = jsonHandler(completion("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 2000 }));
    const recorder = await h.start({ mode: "record" });
    await call(recorder.baseUrl, { body: MESSAGES });
    await recorder.close();
    const replayer = await h.start({ mode: "replay", apiKey: null, budget: new GatewayBudget(0.01) });
    expect((await call(replayer.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect((await call(replayer.baseUrl, { body: MESSAGES })).status).toBe(402);
  });
});
