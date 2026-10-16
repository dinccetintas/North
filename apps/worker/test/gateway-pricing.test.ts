import { readdir } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GatewayBudget } from "../src/gateway/budget";
import { call, completion, errorType, jsonHandler, MESSAGES, sseEvent, USAGE, useGateway } from "./gateway-helpers";

/**
 * TST-1: spend the cap must not miss. A reply is priced from its own stream
 * (not from the bounded copy kept for recording); an unknown model is priced
 * at the dearest rate; a 2xx reply with no readable usage under a cap closes
 * the day instead of counting as free.
 */

const h = useGateway();

const TOP_RATE_USD = (1000 * 4 + 200 * 20) / 1_000_000; // USAGE (1000 in, 200 out) at the Opus rates

const stream = (usage: Record<string, unknown>, model = "claude-sonnet-5-5", padding = 0): Buffer =>
  Buffer.from(
    sseEvent("message_start", { message: { model, usage: { input_tokens: usage.input_tokens, output_tokens: 1 } } }) +
      (padding > 0 ? sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "p".repeat(padding) } }) : "") +
      sseEvent("message_delta", { delta: {}, usage: { output_tokens: usage.output_tokens } }) +
      sseEvent("message_stop", {}),
  );

const sse = (wire: Buffer) => (_req: unknown, res: ServerResponse) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(wire);
};

describe("TST-1 an unknown model is priced at the dearest rate", () => {
  it("charges the Opus rate for a model it has no price for, and still counts it as unpriced", async () => {
    h.upstream.handler = jsonHandler(completion("claude-mystery-9"));
    const gateway = await h.start();
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(gateway.stats()).toMatchObject({ requests: 1, unpriced: 1 });
    expect(gateway.stats().spentUsd).toBeCloseTo(TOP_RATE_USD, 12);
  });

  it("the guess counts toward the cap, so an unfamiliar model id cannot slip past it", async () => {
    h.upstream.handler = jsonHandler(completion("claude-mystery-9"));
    const gateway = await h.start({ budget: new GatewayBudget(0.005) });
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    const refused = await call(gateway.baseUrl, { body: MESSAGES });
    expect(refused.status).toBe(402);
    expect(errorType(refused.body)).toBe("north_budget_exceeded");
    expect(h.upstream.seen).toHaveLength(1);
  });

  it("an unknown model in a stream is priced the same way", async () => {
    h.upstream.handler = sse(stream({ input_tokens: 1000, output_tokens: 200 }, "claude-mystery-9"));
    const gateway = await h.start();
    await call(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(gateway.stats().spentUsd).toBeCloseTo(TOP_RATE_USD, 12);
    expect(gateway.stats().unpriced).toBe(1);
  });
});

describe("TST-1 a streamed reply is priced from the stream, not from the capture", () => {
  it("an SSE reply over the capture limit is priced correctly, served whole, and not recorded", async () => {
    const wire = stream({ input_tokens: 1000, output_tokens: 300 }, "claude-sonnet-5-5", 5000);
    h.upstream.handler = sse(wire);
    const gateway = await h.start({ mode: "record", maxCaptureBytes: 1024 });
    const res = await call(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(res.body.equals(wire)).toBe(true);
    expect(gateway.stats().spentUsd).toBeCloseTo((1000 * 2 + 300 * 10) / 1_000_000, 12);
    expect(gateway.stats().unpriced).toBe(0);
    expect(await readdir(h.dir)).toEqual([]);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatch(/too large to record/i);
    h.logs.length = 0;
  });

  it("pricing never depends on the capture limit, however small", async () => {
    h.upstream.handler = sse(stream({ input_tokens: 1000, output_tokens: 300 }));
    const gateway = await h.start({ maxCaptureBytes: 16 });
    await call(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(gateway.stats().spentUsd).toBeCloseTo((1000 * 2 + 300 * 10) / 1_000_000, 12);
    expect(h.logs).toEqual([]); // nothing to record in live mode, so nothing to warn about
  });
});

describe("TST-1 fast mode", () => {
  it("bills a fast reply at twice the price, in a body and in a stream", async () => {
    h.upstream.handler = jsonHandler(completion("claude-sonnet-5-5", { ...USAGE, speed: "fast" }));
    const gateway = await h.start();
    await call(gateway.baseUrl, { body: MESSAGES });
    const standard = (1000 * 2 + 200 * 10) / 1_000_000;
    expect(gateway.stats().spentUsd).toBeCloseTo(2 * standard, 12);
    const wire = Buffer.from(
      sseEvent("message_start", { message: { model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 1, speed: "fast" } } }) +
        sseEvent("message_delta", { delta: {}, usage: { output_tokens: 200 } }),
    );
    h.upstream.handler = sse(wire);
    await call(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect(gateway.stats().spentUsd).toBeCloseTo(4 * standard, 12);
  });
});

describe("TST-1 a 2xx reply with no readable usage closes the day when there is a cap", () => {
  const closes = async (body: Buffer | string, headers: Record<string, string> = {}, mode: "live" | "record" = "live") => {
    h.upstream.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json", ...headers });
      res.end(body);
    };
    let now = new Date("2026-10-16T22:00:00Z");
    const gateway = await h.start({ budget: new GatewayBudget(5, () => now), mode });
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    return { gateway, setNow: (iso: string) => (now = new Date(iso)) };
  };

  it("TST-1 exhausts the day: later requests are 402 north_budget_unpriced, logged once, until the next UTC day", async () => {
    const { gateway, setNow } = await closes("not json at all");
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatch(/no readable usage/i);
    h.logs.length = 0;
    expect(gateway.stats()).toMatchObject({ spentUsd: 5, capUsd: 5, unpriced: 1, requests: 1 });

    const refused = await call(gateway.baseUrl, { body: MESSAGES });
    expect(refused.status).toBe(402);
    expect(JSON.parse(refused.body.toString())).toEqual({ error: { type: "north_budget_unpriced", cap_usd: 5, spent_usd: 5 } });
    await call(gateway.baseUrl, { body: MESSAGES });
    expect(h.upstream.seen).toHaveLength(1);
    expect(gateway.stats().requests).toBe(1);
    expect(h.logs).toEqual([]);

    setNow("2026-10-17T00:00:00Z");
    h.upstream.handler = jsonHandler(completion());
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(gateway.stats().requests).toBe(2);
    expect(gateway.stats().spentUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.5) / 1_000_000, 12);
  });

  it("an SSE stream without a message_start is the same: no readable usage", async () => {
    h.upstream.handler = sse(Buffer.from(sseEvent("message_delta", { delta: {}, usage: { output_tokens: 5 } }) + sseEvent("message_stop", {})));
    const gateway = await h.start({ budget: new GatewayBudget(5) });
    await call(gateway.baseUrl, { body: { ...MESSAGES, stream: true } });
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(402);
    h.logs.length = 0;
  });

  it("a JSON reply too large to read is the same", async () => {
    const big = JSON.stringify({ ...JSON.parse(completion()), pad: "y".repeat(5000) });
    h.upstream.handler = jsonHandler(big);
    const gateway = await h.start({ budget: new GatewayBudget(5), maxCaptureBytes: 1024 });
    expect((await call(gateway.baseUrl, { body: MESSAGES })).body.toString()).toBe(big);
    expect(errorType((await call(gateway.baseUrl, { body: MESSAGES })).body)).toBe("north_budget_unpriced");
    h.logs.length = 0;
  });

  it("a compressed reply is the same", async () => {
    const { gateway } = await closes(gzipSync(Buffer.from(completion())), { "content-encoding": "gzip" });
    expect(errorType((await call(gateway.baseUrl, { body: MESSAGES })).body)).toBe("north_budget_unpriced");
    h.logs.length = 0;
  });

  it("recording does not change it", async () => {
    const { gateway } = await closes("not json at all", {}, "record");
    expect((await call(gateway.baseUrl, { body: MESSAGES })).status).toBe(402);
    h.logs.length = 0;
  });

  it("an upstream error does not close the day, and with no cap an unreadable reply only counts", async () => {
    h.upstream.handler = jsonHandler(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), 529);
    const capped = await h.start({ budget: new GatewayBudget(5) });
    expect((await call(capped.baseUrl, { body: MESSAGES })).status).toBe(529);
    h.upstream.handler = jsonHandler(completion());
    expect((await call(capped.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(capped.stats().unpriced).toBe(0);

    h.upstream.handler = jsonHandler("not json at all");
    const free = await h.start();
    expect((await call(free.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect((await call(free.baseUrl, { body: MESSAGES })).status).toBe(200);
    expect(free.stats()).toMatchObject({ unpriced: 2, spentUsd: 0 });
    expect(h.logs).toEqual([]);
  });
});
