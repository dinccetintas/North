// Test helpers for the model gateway: a fake upstream on a loopback port that
// records what it receives, and a raw `node:http` caller (fetch cannot set Host).
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { GatewayBudget } from "../src/gateway/budget";
import { startGateway, type Gateway, type GatewayOptions } from "../src/gateway/server";

export interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export interface FakeUpstream {
  readonly url: string;
  readonly host: string;
  readonly seen: SeenRequest[];
  /** What answers the next requests; replace it per test. */
  handler: (request: SeenRequest, res: ServerResponse) => void;
  close(): Promise<void>;
}

export const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** A Messages API non-streaming body. */
export const completion = (model = "claude-haiku-5-5", usage: Record<string, unknown> = USAGE, text = "Done."): string =>
  JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model, content: [{ type: "text", text }], usage });

/** Answers every request with a 200 JSON completion. */
export const jsonHandler =
  (body: string, status = 200, headers: Record<string, string> = {}) =>
  (_request: SeenRequest, res: ServerResponse): void => {
    res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake", ...headers });
    res.end(body);
  };

/** One SSE event as the Messages API writes it. */
export const sseEvent = (type: string, data: Record<string, unknown>): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

export async function fakeUpstream(): Promise<FakeUpstream> {
  const seen: SeenRequest[] = [];
  const state = { handler: jsonHandler(completion()) };
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const request: SeenRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(request);
      state.handler(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    seen,
    get handler() {
      return state.handler;
    },
    set handler(next) {
      state.handler = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export interface CallInit {
  method?: string;
  path?: string;
  /** Merged over the defaults (placeholder key, JSON, version); `null` removes a default. */
  headers?: Record<string, string | null>;
  body?: Buffer | string | Record<string, unknown>;
}

const toBuffer = (body: CallInit["body"]): Buffer => (body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));

/** Builds the request headers and options for `call` and `open`. */
function requestOptions(baseUrl: string, init: CallInit, payload: Buffer) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": "north-gateway", "anthropic-version": "2023-06-01", "content-length": String(payload.length) };
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const base = new URL(baseUrl);
  // The raw path goes on the wire as given (a test may send "//evil.example/v1/messages").
  return { host: base.hostname, port: base.port, path: init.path ?? "/v1/messages", method: init.method ?? "POST", headers };
}

/** Sends one request and collects the whole reply. */
export function call(baseUrl: string, init: CallInit = {}): Promise<Reply> {
  const payload = toBuffer(init.body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(requestOptions(baseUrl, init, payload), (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(payload);
  });
}

export interface OpenCall {
  readonly response: Promise<IncomingMessage>;
  readonly request: ReturnType<typeof httpRequest>;
}

/** Sends a request and hands back the live response, for tests that read it in pieces or hang up. */
export function open(baseUrl: string, init: CallInit = {}): OpenCall {
  const payload = toBuffer(init.body);
  let request!: ReturnType<typeof httpRequest>;
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    request = httpRequest(requestOptions(baseUrl, init, payload), resolve);
    request.on("error", reject);
    request.end(payload);
  });
  return { response, request };
}

/** A port nothing listens on. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Reads a streamed reply until `until` appears in what has arrived; rejects if the stream ends first. */
export function readUntil(res: IncomingMessage, until: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    res.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      if (text.includes(until)) resolve(text);
    });
    res.on("end", () => reject(new Error(`stream ended before "${until}"`)));
    res.on("error", reject);
  });
}

export const REAL_KEY = "sk-ant-api03-THE-REAL-KEY";
export const MESSAGES = { model: "claude-haiku-5-5", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };

export interface GatewayHarness {
  /** The fake upstream of the current test. */
  readonly upstream: FakeUpstream;
  /** A fresh temp directory for cassettes. */
  readonly dir: string;
  /** What the gateway logged; a test that expects a warning clears it, the others must leave it empty. */
  readonly logs: string[];
  /** Starts a gateway on the fake upstream (live mode, no cap, logging into `logs`) and closes it after the test. */
  start(overrides?: Partial<GatewayOptions>): Promise<Gateway>;
}

/** Registers the hooks every gateway test file needs and returns the per-test state. */
export function useGateway(): GatewayHarness {
  let upstream!: FakeUpstream;
  let dir = "";
  let gateways: Gateway[] = [];
  const logs: string[] = [];
  beforeEach(async () => {
    upstream = await fakeUpstream();
    dir = await mkdtemp(join(tmpdir(), "north-gateway-"));
    gateways = [];
    logs.length = 0;
  });
  afterEach(async () => {
    await Promise.all(gateways.map((g) => g.close()));
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    get upstream() {
      return upstream;
    },
    get dir() {
      return dir;
    },
    logs,
    async start(overrides = {}) {
      const gateway = await startGateway({ apiKey: REAL_KEY, upstream: upstream.url, mode: "live", cassetteDir: dir, budget: new GatewayBudget(0), log: (message) => logs.push(message), ...overrides });
      gateways.push(gateway);
      return gateway;
    },
  };
}

/** The `error.type` of a gateway error body. */
export const errorType = (body: Buffer): unknown => (JSON.parse(body.toString()) as { error: { type: string } }).error.type;
