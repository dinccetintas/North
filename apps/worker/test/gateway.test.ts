import { readdir } from "node:fs/promises";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { GatewayBudget } from "../src/gateway/budget";
import { call, completion, jsonHandler, MESSAGES, open, readUntil, REAL_KEY, sseEvent, useGateway } from "./gateway-helpers";

/**
 * SEC-1 / TST-1: the loopback model gateway. The agent subprocess holds the
 * placeholder key; only the gateway holds the real one, and it also holds the
 * day's cap. A fake upstream on another loopback port records what it gets.
 */

const h = useGateway();

describe("SEC-1 gateway key handling", () => {
  it("SEC-1 gateway injects the key and strips the caller's", async () => {
    const gateway = await h.start();
    const res = await call(gateway.baseUrl, {
      path: "/v1/messages?beta=true",
      headers: { authorization: "Bearer caller-token", "anthropic-beta": "prompt-caching-2024-07-31", "user-agent": "claude-cli/9" },
      body: MESSAGES,
    });
    expect(res.status).toBe(200);
    expect(h.upstream.seen).toHaveLength(1);
    const seen = h.upstream.seen[0]!;
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("/v1/messages?beta=true");
    expect(seen.headers["x-api-key"]).toBe(REAL_KEY);
    expect(seen.headers.authorization).toBeUndefined();
    expect(seen.headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen.headers["anthropic-beta"]).toBe("prompt-caching-2024-07-31");
    expect(seen.headers["content-type"]).toBe("application/json");
    expect(seen.headers["user-agent"]).toBe("claude-cli/9");
    expect(seen.headers.host).toBe(h.upstream.host);
    expect(JSON.parse(seen.body.toString())).toEqual(MESSAGES);
    expect(JSON.stringify(seen.headers)).not.toContain("north-gateway");
  });

  it("drops hop-by-hop headers, anything the Connection header names, and asks for an uncompressed reply", async () => {
    const gateway = await h.start();
    await call(gateway.baseUrl, {
      headers: { connection: "keep-alive, x-secret-hop", "x-secret-hop": "1", "keep-alive": "timeout=5", te: "trailers", "proxy-authorization": "Basic Zm9v", "proxy-connection": "keep-alive", "accept-encoding": "gzip, br", "x-kept": "yes" },
      body: MESSAGES,
    });
    const headers = h.upstream.seen[0]!.headers;
    for (const name of ["x-secret-hop", "keep-alive", "te", "proxy-authorization", "proxy-connection"]) expect(headers[name], name).toBeUndefined();
    expect(headers["accept-encoding"]).toBe("identity");
    expect(headers["x-kept"]).toBe("yes");
    expect(headers["content-length"]).toBe(String(Buffer.byteLength(JSON.stringify(MESSAGES))));
  });

  it("answers 401 unless the caller carries exactly the placeholder key, before anything else", async () => {
    const gateway = await h.start();
    for (const headers of [{ "x-api-key": null }, { "x-api-key": "wrong" }, { "x-api-key": REAL_KEY }, { "x-api-key": "north-gateway2" }, { "x-api-key": null, authorization: "Bearer north-gateway" }] as const) {
      const res = await call(gateway.baseUrl, { headers, body: MESSAGES });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_gateway_unauthorized" } });
    }
    // Before routing: a wrong key on an unknown path is still a 401, not a 404.
    expect((await call(gateway.baseUrl, { path: "/", method: "GET", headers: { "x-api-key": "wrong" } })).status).toBe(401);
    expect(h.upstream.seen).toHaveLength(0);
    expect(gateway.stats().requests).toBe(0);
  });

  it("refuses a Host that is not loopback with 403, whatever the key (DNS rebinding)", async () => {
    const gateway = await h.start();
    for (const host of ["evil.example", "evil.example:80", "127.0.0.1.evil.example", "169.254.169.254", "north-gateway.local"]) {
      const res = await call(gateway.baseUrl, { headers: { host }, body: MESSAGES });
      expect(res.status, host).toBe(403);
      expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_gateway_forbidden" } });
    }
    expect(h.upstream.seen).toHaveLength(0);
    const port = new URL(gateway.baseUrl).port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, "localhost"]) {
      expect((await call(gateway.baseUrl, { headers: { host }, body: MESSAGES })).status, host).toBe(200);
    }
  });

  it("refuses a request with no Host header at all", async () => {
    const gateway = await h.start();
    const { port } = new URL(gateway.baseUrl);
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), "127.0.0.1", () => socket.write("POST /v1/messages HTTP/1.0\r\nx-api-key: north-gateway\r\ncontent-length: 2\r\n\r\n{}"));
      let text = "";
      socket.on("data", (chunk) => (text += chunk.toString()));
      socket.on("end", () => resolve(text));
      socket.on("error", reject);
    });
    expect(reply).toMatch(/^HTTP\/1\.1 403 /);
    expect(h.upstream.seen).toHaveLength(0);
  });

  it("proxies only POST /v1/messages and POST /v1/messages/count_tokens; everything else is 404", async () => {
    const gateway = await h.start();
    const attempts: Array<{ method: string; path: string }> = [
      { method: "GET", path: "/" },
      { method: "POST", path: "/v1/other" },
      { method: "GET", path: "/v1/messages" },
      { method: "POST", path: "/v1/messages/extra" },
      { method: "POST", path: "/v1/messages/count_tokens/x" },
      { method: "POST", path: "/v1/models" },
      { method: "POST", path: "/v1/messages/../models" },
      { method: "POST", path: "//evil.example/v1/messages" },
      { method: "POST", path: "http://evil.example/v1/messages" },
      { method: "DELETE", path: "/v1/messages" },
      { method: "POST", path: "/V1/messages" },
    ];
    for (const attempt of attempts) {
      const res = await call(gateway.baseUrl, { ...attempt, body: MESSAGES });
      expect(res.status, `${attempt.method} ${attempt.path}`).toBe(404);
      expect(JSON.parse(res.body.toString())).toEqual({ error: { type: "north_gateway_not_found" } });
    }
    expect(h.upstream.seen).toHaveLength(0);
    expect(gateway.stats().requests).toBe(0);
  });

  it("never takes the upstream from the request: the Host and path it names change nothing", async () => {
    const gateway = await h.start();
    await call(gateway.baseUrl, { headers: { host: `127.0.0.1:${new URL(gateway.baseUrl).port}`, "x-forwarded-host": "evil.example" }, body: MESSAGES });
    expect(h.upstream.seen).toHaveLength(1);
    expect(h.upstream.seen[0]!.headers.host).toBe(h.upstream.host);
  });
});

describe("TST-1 gateway pricing and the day cap", () => {
  it("prices a JSON response from its usage and settles the budget", async () => {
    h.upstream.handler = jsonHandler(
      completion("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 500, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 150, ephemeral_1h_input_tokens: 50 } }),
    );
    const budget = new GatewayBudget(0);
    const gateway = await h.start({ budget });
    const res = await call(gateway.baseUrl, { body: MESSAGES });
    expect(res.status).toBe(200);
    const expected = (1000 * 2 + 150 * 2.5 + 50 * 4 + 500 * 0.1 + 300 * 10) / 1_000_000;
    expect(gateway.stats()).toEqual({ requests: 1, spentUsd: expect.closeTo(expected, 12), misses: 0, unpriced: 0, capUsd: 0 });
    expect(budget.stats().spentUsd).toBeCloseTo(expected, 12);
  });

  it("streams an SSE body unchanged and prices the final usage", async () => {
    const usageStart = { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 200, cache_read_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 150, ephemeral_1h_input_tokens: 50 } };
    const events = [
      sseEvent("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], usage: usageStart } }),
      'event: ping\ndata: {"type": "ping"}\n\n',
      sseEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "héllo ✓" } }),
      sseEvent("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } }),
      sseEvent("message_stop", {}),
    ];
    const wire = Buffer.from(events.join(""), "utf8");
    h.upstream.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      // Split inside an event and inside a multi-byte character: the gateway must not care.
      const cut = events[0]!.length + 10;
      res.write(wire.subarray(0, cut));
      setTimeout(() => res.end(wire.subarray(cut)), 5);
    };
    const gateway = await h.start();
    const res = await call(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body.equals(wire)).toBe(true);
    const expected = (1000 * 2 + 150 * 2.5 + 50 * 4 + 500 * 0.1 + 300 * 10) / 1_000_000;
    expect(gateway.stats().spentUsd).toBeCloseTo(expected, 12);
    expect(gateway.stats().unpriced).toBe(0);
  });

  it("really streams: the first event reaches the caller while the upstream is still writing", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const start1 = sseEvent("message_start", { message: { model: "claude-haiku-5-5", usage: { input_tokens: 10, output_tokens: 1 } } });
    const rest = sseEvent("message_delta", { delta: {}, usage: { output_tokens: 5 } }) + sseEvent("message_stop", {});
    h.upstream.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(start1);
      void held.then(() => res.end(rest));
    };
    const gateway = await h.start();
    const { response } = open(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    const res = await response;
    const first = await readUntil(res, "message_start");
    expect(first).toBe(start1);
    release();
    await new Promise<void>((resolve) => res.on("end", resolve));
    expect(gateway.stats().spentUsd).toBeCloseTo((10 * 0.1 + 5 * 0.5) / 1_000_000, 12);
  });

  it("the final message_delta wins when it carries the cumulative usage", async () => {
    const wire =
      sseEvent("message_start", { message: { model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } } }) +
      sseEvent("message_delta", { delta: {}, usage: { input_tokens: 120, output_tokens: 400, cache_read_input_tokens: 15, cache_creation_input_tokens: null } }) +
      sseEvent("message_stop", {});
    h.upstream.handler = jsonHandler(wire, 200, { "content-type": "text/event-stream; charset=utf-8" });
    const gateway = await h.start();
    await call(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(gateway.stats().spentUsd).toBeCloseTo((120 * 2 + 15 * 0.1 + 400 * 10) / 1_000_000, 12);
  });

  it("TST-1 answers 402 once the day's cap is spent and counts nothing more, and accepts again when the clock moves to the next day", async () => {
    // 2000 output tokens of Sonnet is 0.02 USD, over the 0.01 cap.
    h.upstream.handler = jsonHandler(completion("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 2000 }));
    let now = new Date("2026-10-16T23:00:00Z");
    const budget = new GatewayBudget(0.01, () => now);
    const gateway = await h.start({ budget });

    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(gateway.stats()).toMatchObject({ requests: 1, capUsd: 0.01 });
    expect(gateway.stats().spentUsd).toBeCloseTo(0.02, 12);

    const refused = await call(gateway.baseUrl, { body: MESSAGES });
    expect(refused.status).toBe(402);
    expect(refused.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(refused.body.toString()) as { error: { type: string; cap_usd: number; spent_usd: number } };
    expect(body.error.type).toBe("north_budget_exceeded");
    expect(body.error.cap_usd).toBe(0.01);
    expect(body.error.spent_usd).toBeCloseTo(0.02, 12);
    await call(gateway.baseUrl, { body: MESSAGES });
    expect(h.upstream.seen).toHaveLength(1);
    expect(gateway.stats().requests).toBe(1);
    expect(gateway.stats().spentUsd).toBeCloseTo(0.02, 12);

    now = new Date("2026-10-17T00:00:00Z");
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(h.upstream.seen).toHaveLength(2);
    expect(gateway.stats().requests).toBe(2);
    expect(gateway.stats().spentUsd).toBeCloseTo(0.02, 12);
  });

  it("the cap also stops a request refused at exactly the cap", async () => {
    // 1000 output tokens of Sonnet is exactly 0.01 USD.
    h.upstream.handler = jsonHandler(completion("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 1000 }));
    const gateway = await h.start({ budget: new GatewayBudget(0.01) });
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(402);
    expect(h.upstream.seen).toHaveLength(1);
  });

  it("an unknown model is unpriced: it counts in `unpriced` and adds nothing", async () => {
    h.upstream.handler = jsonHandler(completion("claude-mystery-9"));
    const gateway = await h.start();
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(gateway.stats()).toMatchObject({ requests: 1, spentUsd: 0, unpriced: 1 });
  });

  it("a 2xx without usable usage settles 0 and counts as unpriced; an upstream error does not", async () => {
    const gateway = await h.start();
    for (const body of ["not json at all", JSON.stringify({ model: "claude-haiku-5-5" }), JSON.stringify({ model: "claude-haiku-5-5", usage: { input_tokens: "many" } })]) {
      h.upstream.handler = jsonHandler(body);
      expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    }
    expect(gateway.stats()).toMatchObject({ requests: 3, spentUsd: 0, unpriced: 3 });
    h.upstream.handler = jsonHandler(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), 529);
    const failed = await call(gateway.baseUrl, { body: MESSAGES });
    expect(failed.status).toBe(529);
    expect(JSON.parse(failed.body.toString()).error.type).toBe("overloaded_error");
    expect(gateway.stats()).toMatchObject({ requests: 4, spentUsd: 0, unpriced: 3 });
  });

  it("count_tokens is proxied but never priced or counted", async () => {
    h.upstream.handler = jsonHandler(JSON.stringify({ input_tokens: 4242 }));
    const gateway = await h.start({ mode: "record" });
    const res = await call(gateway.baseUrl, { path: "/v1/messages/count_tokens", body: MESSAGES });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({ input_tokens: 4242 });
    expect(h.upstream.seen[0]!.url).toBe("/v1/messages/count_tokens");
    expect(h.upstream.seen[0]!.headers["x-api-key"]).toBe(REAL_KEY);
    expect(gateway.stats()).toMatchObject({ requests: 0, spentUsd: 0, unpriced: 0 });
    expect(await readdir(h.dir)).toEqual([]);
  });

  it("count_tokens does not pass through the day cap check nor spend it", async () => {
    h.upstream.handler = jsonHandler(JSON.stringify({ input_tokens: 1 }));
    const budget = new GatewayBudget(0.01);
    budget.settle(5);
    const gateway = await h.start({ budget });
    expect((await call(gateway.baseUrl, { path: "/v1/messages/count_tokens", body: MESSAGES })).status).toBe(200);
    expect(budget.stats().spentUsd).toBe(5);
  });
});
